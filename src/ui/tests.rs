use super::*;
#[test]
fn schedule_paste_keeps_tabs_and_uses_browser_tab_stops() {
    let ctx = egui::Context::default();
    let text = "123456789\tX\né\tY";
    let _ = ctx.run(egui::RawInput::default(), |ctx| {
        egui::CentralPanel::default().show(ctx, |ui| {
            let font = egui::FontId::monospace(14.);
            let space = ui.fonts_mut(|fonts| fonts.glyph_width(&font, ' '));
            let galley = screens::schedule_galley(ui, text, font, 19.6, Color32::WHITE);
            assert_eq!(
                galley.job.text, text,
                "Pasted TSV must remain byte-for-byte intact"
            );
            for (row, letter, columns) in [(0, 'X', 16.), (1, 'Y', 8.)] {
                let glyph = galley.rows[row]
                    .glyphs
                    .iter()
                    .find(|g| g.chr == letter)
                    .unwrap();
                assert!(
                    (glyph.pos.x - space * columns).abs() < 1.5,
                    "{letter} did not follow the next eight-space tab stop"
                );
            }
        });
    });
}
fn setup(custom: bool) -> (tempfile::TempDir, egui::Context, App) {
    let temporary = tempfile::tempdir().unwrap();
    let profile = Arc::new(Profile::open(temporary.path().into()).unwrap());
    let ctx = egui::Context::default();
    let mut fonts = egui::FontDefinitions::default();
    let family = fonts.families[&egui::FontFamily::Proportional].clone();
    for name in [
        "regular",
        "medium",
        "semibold",
        "bold",
        "picker-regular",
        "picker-bold",
    ] {
        fonts
            .families
            .insert(egui::FontFamily::Name(name.into()), family.clone());
    }
    ctx.set_fonts(fonts);
    egui_extras::install_image_loaders(&ctx);
    let (event_tx, rx) = mpsc::channel();
    let wake = Arc::new(OnceLock::new());
    let _ = wake.set(ctx.clone());
    let tx = EventSender {
        inner: event_tx,
        wake,
    };
    let (_, host_rx) = mpsc::channel();
    let item = Item {
        id: "task".into(),
        kind: "deadline".into(),
        title: "Gesture regression fixture".into(),
        course: "Personal".into(),
        due_date: Some("2030-11-09T00:00:00Z".into()),
        time_estimate: Some("30m".into()),
        is_manual: custom,
        is_custom: custom,
        ..Default::default()
    };
    let app = App {
        profile,
        settings: Settings::default(),
        state: State {
            items: vec![item],
            ..Default::default()
        },
        rt: tokio::runtime::Runtime::new().unwrap(),
        tx,
        rx,
        session: None,
        session_unsaved: false,
        reconnect_required: false,
        credential_read_failed: false,
        authenticated: true,
        checking: false,
        migration_required: false,
        loading: false,
        fetching: false,
        manual_sync: false,
        sync_feedback_until: None,
        startup_enabled: false,
        auth_waiting: false,
        auth_success: None,
        auth_url: String::new(),
        error: None,
        tab: 2,
        last_fetch: None,
        poll_task: None,
        last_shape: Instant::now(),
        attached: false,
        #[cfg(target_os = "linux")]
        taskbar_checked: false,
        resize_pending: true,
        parent: None,
        hosted: false,
        host_rx,
        last_data: None,
        form: None,
        card_states: HashMap::new(),
        estimating: HashSet::new(),
        schedule_text: String::new(),
        courses: Vec::new(),
        import_open: false,
        import_schedule: false,
        import_day: 0,
        import_status: None,
        import_status_until: None,
        month: Local::now().date_naive().with_day(1).unwrap(),
        selected_day: None,
        archive: Vec::new(),
        update_course: "All".into(),
        ai_checking: false,
        ai_generation: 0,
        ai_online: false,
        ai_ready: false,
        ai_pulling: false,
        ai_progress: 0,
        messages: Vec::new(),
        chat_input: String::new(),
        typing: false,
    };
    (temporary, ctx, app)
}
fn draw(ctx: &egui::Context, app: &mut App, time: f64, events: Vec<egui::Event>) {
    let _ = ctx.run(
        egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(
                egui::Pos2::ZERO,
                egui::vec2(360., 520.),
            )),
            time: Some(time),
            events,
            ..Default::default()
        },
        |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                let item = app.state.items[0].clone();
                app.card(ui, &item);
            });
        },
    );
}
fn pointer(x: f32, y: f32, down: bool) -> Vec<egui::Event> {
    let pos = egui::pos2(x, y);
    vec![
        egui::Event::PointerMoved(pos),
        egui::Event::PointerButton {
            pos,
            button: egui::PointerButton::Primary,
            pressed: down,
            modifiers: egui::Modifiers::NONE,
        },
    ]
}
#[test]
fn datetime_popup_selects_a_day_hour_minute_period_and_clears() {
    let (_temp, ctx, _app) = setup(true);
    let mut form = Form {
        date: "11/09/2026 07:03 PM".into(),
        ..Default::default()
    };
    form.open_date_picker();
    let anchor = egui::Rect::from_min_size(egui::pos2(13., 165.), egui::vec2(334., 35.));
    let mut time = 0.;
    let mut draw = |form: &mut Form, events| {
        time += 0.1;
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(500., 520.),
                )),
                time: Some(time),
                events,
                ..Default::default()
            },
            |ctx| form.date_popup(ctx, anchor),
        );
    };
    draw(&mut form, vec![]);
    draw(&mut form, vec![]);
    for (x, y) in [(317., 269.), (261., 269.), (373., 269.), (94., 316.)] {
        draw(&mut form, pointer(x, y, true));
        draw(&mut form, pointer(x, y, false));
    }
    assert_eq!(form.date, "11/10/2026 08:04 AM");
    draw(&mut form, pointer(50., 462., true));
    draw(&mut form, pointer(50., 462., false));
    assert!(form.date.is_empty());
    assert!(!form.picker_open);
}
#[test]
fn datetime_year_list_keeps_the_value_until_a_day_is_chosen() {
    let (_temp, ctx, _app) = setup(true);
    let mut form = Form {
        date: "11/09/2026 07:03 PM".into(),
        ..Default::default()
    };
    form.open_date_picker();
    form.picker_years = true;
    form.picker_expanded_year = 2026;
    form.picker_year_scroll = true;
    let anchor = egui::Rect::from_min_size(egui::pos2(13., 165.), egui::vec2(334., 35.));
    let mut time = 0.;
    let mut draw = |form: &mut Form, events| {
        time += 0.1;
        let _ = ctx.run(
            egui::RawInput {
                screen_rect: Some(egui::Rect::from_min_size(
                    egui::Pos2::ZERO,
                    egui::vec2(500., 520.),
                )),
                time: Some(time),
                events,
                ..Default::default()
            },
            |ctx| form.date_popup(ctx, anchor),
        );
    };
    draw(&mut form, vec![]);
    draw(&mut form, vec![]);
    draw(&mut form, pointer(70., 385., true));
    draw(&mut form, pointer(70., 385., false));
    draw(&mut form, vec![]);
    assert_eq!(form.picker_expanded_year, 2027);
    draw(&mut form, pointer(92., 312., true));
    draw(&mut form, pointer(92., 312., false));
    assert_eq!(form.picker_month, NaiveDate::from_ymd_opt(2027, 2, 1));
    assert!(!form.picker_years);
    assert_eq!(form.date, "11/09/2026 07:03 PM");
    draw(&mut form, vec![]);
    draw(&mut form, pointer(122., 316., true));
    draw(&mut form, pointer(122., 316., false));
    assert_eq!(form.date, "02/10/2027 07:03 PM");
}
#[test]
fn swiping_a_custom_task_reveals_delete_after_release() {
    let (_temp, ctx, mut app) = setup(true);
    draw(&ctx, &mut app, 0., vec![]);
    draw(&ctx, &mut app, 0.1, pointer(180., 45., true));
    draw(
        &ctx,
        &mut app,
        0.15,
        vec![egui::Event::PointerMoved(egui::pos2(90., 45.))],
    );
    draw(&ctx, &mut app, 0.2, pointer(90., 45., false));
    assert!(app.card_states["task"].revealed);
    assert!(!app.state.items[0].completed);
}
#[test]
fn double_click_reveals_delete_without_completing_the_task() {
    let (_temp, ctx, mut app) = setup(true);
    draw(&ctx, &mut app, 0., vec![]);
    draw(&ctx, &mut app, 0.1, pointer(100., 45., true));
    draw(&ctx, &mut app, 0.12, pointer(100., 45., false));
    assert!(app.card_states["task"].click.is_some());
    draw(&ctx, &mut app, 0.18, pointer(100., 45., true));
    draw(&ctx, &mut app, 0.20, pointer(100., 45., false));
    assert!(app.card_states["task"].revealed);
    assert!(app.card_states["task"].click.is_none());
    assert!(!app.state.items[0].completed);
}
#[test]
fn canvas_task_click_persists_a_local_completion_choice() {
    let (_temp, ctx, mut app) = setup(false);
    draw(&ctx, &mut app, 0., vec![]);
    draw(&ctx, &mut app, 0.1, pointer(100., 45., true));
    draw(&ctx, &mut app, 0.12, pointer(100., 45., false));
    assert!(app.state.items[0].completed);
    assert!(app.profile.read::<State>("state.json").unwrap().items[0].completed);
    assert_eq!(
        app.state.task_completion_overrides["task"],
        Override {
            completed: true,
            canvas_completed: false
        }
    );
}
#[test]
fn a_reply_from_a_closed_chat_keeps_its_action_but_cannot_change_the_new_chat() {
    let (_temporary, _ctx, mut app) = setup(true);
    app.tab = 0;
    app.ai_generation = 2;
    app.typing = true;
    app.messages = vec![json!({"role":"assistant","content":"New chat"})];
    app.state.items[0].zoom_link = Some("https://zoom.us/j/123".into());
    app.state.items[0].due_date = Some((Utc::now() - chrono::Duration::days(1)).to_rfc3339());
    app.tx
        .send(Event::Chat(
            1,
            Some("Old reply".into()),
            Some(json!({"intent":"delete_meeting"})),
        ))
        .unwrap();
    app.events();
    assert!(app.state.items[0].zoom_link.is_none());
    assert_eq!(
        app.messages,
        vec![json!({"role":"assistant","content":"New chat"})]
    );
    assert!(app.typing);
}
