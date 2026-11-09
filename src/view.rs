//! Pure view rules, with explicit time to keep JavaScript/Rust comparisons deterministic.
use crate::{model::Item, schedule::Course};
use chrono::{DateTime, Datelike, FixedOffset};
use std::cmp::Ordering;
pub fn filtered(
    items: &[Item],
    tab: &str,
    schedule: &[Course],
    now: DateTime<FixedOffset>,
) -> Vec<Item> {
    let mut result: Vec<_> = items
        .iter()
        .filter(|item| {
            let date = item.timestamp();
            if tab != "Calendar" {
                if item.completed && date.is_some_and(|date| date <= now) {
                    return false;
                }
                if item.kind == "event"
                    && date.is_some_and(|date| {
                        date.with_timezone(now.offset()).date_naive() < now.date_naive()
                    })
                {
                    return false;
                }
            }
            match tab {
                "Tasks" => item.kind == "deadline",
                "Updates" => matches!(item.kind.as_str(), "announcement" | "comment"),
                _ => matches!(item.kind.as_str(), "deadline" | "event"),
            }
        })
        .filter(|item| {
            schedule.is_empty()
                || item.is_manual
                || item.course == "Personal"
                || schedule.iter().any(|c| {
                    item.course
                        .to_lowercase()
                        .contains(&c.course_code.to_lowercase())
                })
        })
        .cloned()
        .collect();
    if !schedule.is_empty() {
        for item in &mut result {
            if item.zoom_link.is_none() {
                continue;
            }
            let day = item.timestamp().map(|d| {
                d.with_timezone(now.offset())
                    .weekday()
                    .num_days_from_sunday() as usize
            });
            let day = day.map(|i| ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][i]);
            if !schedule.iter().any(|c| {
                item.course
                    .to_lowercase()
                    .contains(&c.course_code.to_lowercase())
                    && day == Some(c.day.as_str())
                    && c.is_online
            }) {
                item.zoom_link = None;
            }
        }
    }
    result.sort_by(|a, b| match (a.timestamp(), b.timestamp()) {
        (Some(a), Some(b)) => a.cmp(&b),
        _ => Ordering::Equal,
    });
    result
}
pub fn primary_time_label(item: &Item, now: DateTime<FixedOffset>) -> String {
    let Some(date) = item.timestamp() else {
        return "NaN/NaN".into();
    };
    let seconds = date.signed_duration_since(now).num_milliseconds() as f64 / 1000.;
    if seconds < 0. {
        return if item.completed || item.kind != "deadline" {
            "Past"
        } else {
            "Missing"
        }
        .into();
    }
    let hours = (seconds / 3600.).floor() as i64;
    if hours < 24 {
        format!("{hours}h")
    } else {
        let date = date.with_timezone(now.offset());
        format!("{}/{}", date.month(), date.day())
    }
}
pub fn urgent(item: &Item, now: DateTime<FixedOffset>) -> bool {
    item.timestamp().is_some_and(|d| {
        let ms = (d - now).num_milliseconds();
        ms > 0 && ms < 86_400_000
    })
}
