use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Course {
    pub day: String,
    pub time_slot: String,
    pub course_code: String,
    pub course_title: String,
    pub venue: String,
    pub teacher: String,
    pub is_online: bool,
}
pub fn parse(raw: &str) -> Vec<Course> {
    let lines: Vec<_> = raw
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    let Some(header) = lines.first() else {
        return vec![];
    };
    let days: Vec<String> = header
        .split('\t')
        .map(|s| s.trim().chars().take(3).collect::<String>().to_uppercase())
        .collect();
    // The JS parser uses a lazy optional suffix; Rust regex cannot express that suffix's
    // preference, so split the room marker before matching the same four fields.
    let pattern = regex::Regex::new(
        r"(?i)-\s*(.*?)\s*-\s*(.*?)\s*(?:Offline\s*)?Venue\s*:\s*(.*?)\s*Teacher\s*:\s*(.*)",
    )
    .unwrap();
    let room = regex::Regex::new(r"(?i)\s*Room No\s*:").unwrap();
    let mut courses = Vec::new();
    for line in lines.iter().skip(1) {
        let cells: Vec<_> = line.split('\t').collect();
        for (i, cell) in cells.iter().enumerate().skip(1) {
            let Some(day) = days.get(i).filter(|d| {
                ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].contains(&d.as_str())
            }) else {
                continue;
            };
            let cell = room.split(cell.trim()).next().unwrap_or("");
            if let Some(c) = pattern.captures(cell) {
                let venue = c[3].trim().to_owned();
                courses.push(Course {
                    day: day.clone(),
                    time_slot: cells[0].trim().into(),
                    course_code: c[1].trim().into(),
                    course_title: c[2].trim().into(),
                    is_online: venue.eq_ignore_ascii_case("online"),
                    venue,
                    teacher: c[4].trim().into(),
                });
            }
        }
    }
    courses
}
