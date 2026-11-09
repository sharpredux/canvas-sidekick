use super::*;
fn setup(custom: bool) -> (tempfile::TempDir, egui::Context, App) {
    let temporary = tempfile::tempdir().unwrap();
    let profile = Arc::new(Profile::open(temporary.path().into()).unwrap());
    let ctx = egui::Context::default();
    let mut fonts = egui::FontDefinitions::default();
    let family = fonts.families[&egui::FontFamily::Proportional].clone();
    for name in ["medium", "semibold", "bold"] {
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
        canvas: None,
        session: None,
        authenticated: true,
        checking: false,
        migration_required: false,
        loading: false,
        fetching: false,
        manual_sync: false,
        sync_feedback_until: None,
        auth_waiting: false,
        auth_success: None,
        auth_url: String::new(),
        error: None,
        tab: 2,
        last_fetch: None,
        poll_task: None,
        last_shape: Instant::now(),
        attached: false,
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
