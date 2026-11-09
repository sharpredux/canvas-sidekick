use crate::model::Item;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub fn is_assignment_completed(a: &Value, submission: Option<&Value>) -> bool {
    let Some(s) = submission
        .or_else(|| a.get("submission"))
        .filter(|s| !s.is_null())
    else {
        return false;
    };
    if s["excused"] == true {
        return true;
    }
    if s["redo_request"] == true {
        return false;
    }
    if matches!(
        s["workflow_state"].as_str(),
        Some("submitted" | "pending_review")
    ) || s["submitted_at"].as_str().is_some_and(|s| !s.is_empty())
    {
        return true;
    }
    if s["missing"] == true || s["late_policy_status"] == "missing" {
        return false;
    }
    if s["workflow_state"] == "graded"
        && number(&s["attempt"]).is_some_and(|n| n > 0.)
        && matches!(
            s["submission_type"].as_str(),
            Some(
                "online_upload"
                    | "online_text_entry"
                    | "online_url"
                    | "online_quiz"
                    | "discussion_topic"
                    | "media_recording"
                    | "student_annotation"
            )
        )
    {
        return true;
    }
    let offline = a["submission_types"].as_array().is_some_and(|types| {
        !types.is_empty()
            && types.iter().all(|t| {
                matches!(
                    t.as_str(),
                    Some("none" | "not_graded" | "on_paper" | "external_tool")
                )
            })
    });
    offline
        && !s["score"].is_null()
        && (number(&s["score"]).is_some_and(|n| n > 0.) || s["missing"] == false)
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64().or_else(|| v.as_str()?.parse().ok())
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Override {
    pub completed: bool,
    pub canvas_completed: bool,
}
pub type Overrides = BTreeMap<String, Override>;
pub fn apply(mut item: Item, overrides: &mut Overrides, previous: Option<&Item>) -> Item {
    let canvas = if item.completion_known == Some(false) {
        previous
            .map(|p| p.canvas_completed.unwrap_or(p.completed))
            .unwrap_or(item.completed)
    } else {
        item.completed
    };
    if !item.is_manual
        && overrides
            .get(&item.id)
            .is_some_and(|o| o.canvas_completed != canvas)
    {
        overrides.remove(&item.id);
    }
    item.canvas_completed = Some(canvas);
    item.completed = overrides
        .get(&item.id)
        .map(|o| o.completed)
        .unwrap_or(canvas);
    item
}
pub fn merge(items: &mut Vec<Item>, new: Vec<Item>, overrides: &mut Overrides) {
    for item in new {
        if let Some(i) = items.iter().position(|x| x.id == item.id) {
            let estimate = items[i].time_estimate.clone();
            let mut updated = apply(item, overrides, Some(&items[i]));
            if updated.time_estimate.as_ref().is_none_or(|s| s.is_empty()) {
                updated.time_estimate = estimate;
            }
            updated.is_custom = updated.is_manual;
            items[i] = updated;
        } else {
            let mut item = apply(item, overrides, None);
            item.is_custom = item.is_manual;
            items.push(item);
        }
    }
    for item in items.iter_mut() {
        item.is_custom = item.is_manual;
    }
}
