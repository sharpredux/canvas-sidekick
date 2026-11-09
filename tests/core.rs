use canvas_sidekick_rust::{
    completion::{self, Override, Overrides},
    model::{Item, Settings},
    schedule,
    storage::{Profile, State},
};
use serde_json::json;
#[test]
fn preserves_unchecked_override_until_canvas_changes() {
    let mut overrides = Overrides::from([(
        "task".into(),
        Override {
            completed: false,
            canvas_completed: true,
        },
    )]);
    let item = Item {
        id: "task".into(),
        completed: true,
        ..Default::default()
    };
    assert!(!completion::apply(item.clone(), &mut overrides, None).completed);
    let changed = Item {
        completed: false,
        ..item
    };
    completion::apply(changed, &mut overrides, None);
    assert!(overrides.is_empty());
}
#[test]
fn merge_retains_old_assignments_and_estimates() {
    let mut items = vec![
        Item {
            id: "old".into(),
            ..Default::default()
        },
        Item {
            id: "current".into(),
            time_estimate: Some("2 hr".into()),
            ..Default::default()
        },
    ];
    completion::merge(
        &mut items,
        vec![Item {
            id: "current".into(),
            completed: true,
            ..Default::default()
        }],
        &mut Overrides::new(),
    );
    assert_eq!(items.len(), 2);
    assert_eq!(items[1].time_estimate.as_deref(), Some("2 hr"));
    assert!(items[1].completed);
}
#[test]
fn settings_preserve_unknown_fields() {
    let mut s: Settings =
        serde_json::from_value(json!({"size":"invalid","textSize":"Largest","future":42})).unwrap();
    s.normalize();
    assert_eq!(s.dimensions(true), [360., 520.]);
    assert_eq!(s.text_scale(), 1.25);
    assert_eq!(serde_json::to_value(s).unwrap()["future"], 42);
}
#[test]
fn profile_has_exclusive_owner_and_roundtrips() {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profile::open(temp.path().into()).unwrap();
    assert!(Profile::open(temp.path().into()).is_err());
    profile
        .write(
            "state.json",
            &State {
                items: vec![Item {
                    id: "personal".into(),
                    is_manual: true,
                    ..Default::default()
                }],
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        profile.read::<State>("state.json").unwrap().items[0].id,
        "personal"
    );
}
#[test]
fn corrupted_state_is_not_silently_discarded() {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profile::open(temp.path().into()).unwrap();
    std::fs::write(temp.path().join("state.json"), "bad json").unwrap();
    assert!(profile.read::<State>("state.json").is_err());
}
#[test]
fn schedule_recognizes_days_venue_and_teacher() {
    let courses = schedule::parse(
        "Time Slot\tMon 08/06\tTue 09/06\n7:30AM - 9:00AM\t- CCINOV8 - INNOVATION Offline Venue : Online Teacher : Melvin Gabriel Ignacio Room No :\t",
    );
    assert_eq!(courses.len(), 1);
    assert_eq!(courses[0].course_code, "CCINOV8");
    assert_eq!(courses[0].teacher, "Melvin Gabriel Ignacio");
    assert!(courses[0].is_online);
}
#[test]
fn archive_uses_legacy_utc_bucket_and_deduplicates() {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profile::open(temp.path().into()).unwrap();
    let items = vec![Item {
        id: "a".into(),
        kind: "deadline".into(),
        completed: true,
        due_date: Some("2026-11-10T01:00:00+08:00".into()),
        ..Default::default()
    }];
    profile.archive(&items).unwrap();
    profile.archive(&items).unwrap();
    assert_eq!(
        profile
            .read::<Vec<Item>>("archive/2026-11-09.json")
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn migration_commits_complete_profile_and_preserves_old_flags() {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profile::open(temp.path().into()).unwrap();
    profile.import_legacy(&json!({"settings":{"schoolUrl":"https://canvas.example","future":42},"manualTasks":[{"id":"manual","isManual":true}],"localCompletedIds":["manual"],"schedule":"raw schedule","archives":{"2026-11-09":[]}})).unwrap();
    assert_eq!(profile.settings().unwrap().extra["future"], 42);
    let state: State = profile.read("state.json").unwrap();
    assert!(state.task_completion_overrides["manual"].completed);
    assert_eq!(
        std::fs::read_to_string(profile.data_dir().join("schedule.txt")).unwrap(),
        "raw schedule"
    );
    assert!(profile.import_legacy(&json!({})).is_err());
}
#[test]
fn invalid_migration_leaves_no_partial_import() {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profile::open(temp.path().into()).unwrap();
    assert!(
        profile
            .import_legacy(&json!({"settings":{},"manualTasks":[],"archives":{"../escape":[]}}))
            .is_err()
    );
    assert!(!profile.root.join("state.json").exists());
    assert!(!profile.root.join("settings.json").exists());
    assert!(!profile.root.join("imported").exists());
    profile
        .import_legacy(&json!({"settings":{},"manualTasks":[]}))
        .unwrap();
}
#[test]
fn stale_temporary_files_do_not_block_future_writes() {
    let temp = tempfile::tempdir().unwrap();
    let profile = Profile::open(temp.path().into()).unwrap();
    std::fs::write(profile.root.join("state.tmp"), "interrupted").unwrap();
    profile.write("state.json", &State::default()).unwrap();
    assert!(profile.read::<State>("state.json").is_ok());
}
