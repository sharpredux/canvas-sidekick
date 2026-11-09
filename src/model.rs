use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

// Keep the legacy field names and unrecognized fields during round trips.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub course: String,
    pub due_date: Option<String>,
    pub date: Option<String>,
    pub completed: bool,
    pub canvas_completed: Option<bool>,
    pub completion_known: Option<bool>,
    pub is_manual: bool,
    pub is_custom: bool,
    pub assignment_id: Option<Value>,
    pub course_id: Option<Value>,
    pub school_url: Option<String>,
    pub submission_types: Vec<String>,
    pub zoom_link: Option<String>,
    pub time_estimate: Option<String>,
    pub preview: Option<String>,
    pub author: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}
impl Item {
    pub fn timestamp(&self) -> Option<chrono::DateTime<chrono::FixedOffset>> {
        use chrono::TimeZone;
        let text = self
            .due_date
            .as_ref()
            .filter(|s| !s.is_empty())
            .or(self.date.as_ref())?;
        if let Ok(date) = chrono::DateTime::parse_from_rfc3339(text) {
            return Some(date);
        }
        // JavaScript treats ISO date-only values as UTC, and datetimes without an offset as local.
        if let Ok(date) = chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d") {
            return Some(date.and_hms_opt(0, 0, 0)?.and_utc().fixed_offset());
        }
        for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
            if let Ok(date) = chrono::NaiveDateTime::parse_from_str(text, format) {
                return chrono::Local
                    .from_local_datetime(&date)
                    .earliest()
                    .map(|d| d.fixed_offset());
            }
        }
        None
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub size: String,
    pub text_size: String,
    pub school_url: String,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            size: "Medium".into(),
            text_size: "Standard".into(),
            school_url: String::new(),
            extra: BTreeMap::new(),
        }
    }
}
impl Settings {
    pub fn normalize(&mut self) {
        if !["Small", "Medium", "Large"].contains(&self.size.as_str()) {
            self.size = "Medium".into();
        }
        if !["Standard", "Larger", "Largest"].contains(&self.text_size.as_str()) {
            self.text_size = "Standard".into();
        }
    }
    pub fn dimensions(&self, linux: bool) -> [f32; 2] {
        match (linux, self.size.as_str()) {
            (true, "Small") => [280., 320.],
            (true, "Large") => [480., 640.],
            (true, _) => [360., 520.],
            (false, "Small") => [200., 200.],
            (false, "Large") => [280., 560.],
            (false, _) => [280., 448.],
        }
    }
    pub fn text_scale(&self) -> f32 {
        match self.text_size.as_str() {
            "Larger" => 1.125,
            "Largest" => 1.25,
            _ => 1.,
        }
    }
}
