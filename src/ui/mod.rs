use canvas_sidekick_rust::{
    canvas::Canvas,
    completion::{self, Override},
    credentials::Credentials,
    model::{Item, Settings},
    ollama::Ollama,
    schedule::{self, Course},
    storage::{Profile, State},
    view,
};
use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Utc};
use eframe::egui::{self, Color32, RichText};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::PathBuf,
    sync::{Arc, OnceLock, mpsc},
    time::{Duration, Instant},
};
mod date_picker;
mod screens;
const BLUE: Color32 = Color32::from_rgb(50, 173, 230);
const GREEN: Color32 = Color32::from_rgb(52, 199, 89);
const RED: Color32 = Color32::from_rgb(255, 69, 58);
const CARD: Color32 = Color32::from_rgb(28, 28, 30);
const MUTED: Color32 = Color32::from_rgb(152, 152, 157);
fn local_now() -> DateTime<Local> {
    #[cfg(debug_assertions)]
    if let Ok(text) = std::env::var("CANVAS_SIDEKICK_TEST_NOW") {
        if let Ok(now) = DateTime::parse_from_rfc3339(&text) {
            return now.with_timezone(&Local);
        }
    }
    Local::now()
}
#[derive(Clone, Copy)]
struct Palette {
    background: Color32,
    text: Color32,
    on_primary: Color32,
    on_accent: Color32,
    primary: Color32,
    success: Color32,
    error: Color32,
    card: Color32,
    muted: Color32,
    outline: Color32,
}
const TABS: [&str; 6] = [
    "AI Chat", "Calendar", "Up Next", "Tasks", "Updates", "Settings",
];
struct BootData {
    settings: Settings,
    state: State,
    schedule: String,
    session: Option<Value>,
}
fn load_boot(profile: &Profile) -> anyhow::Result<BootData> {
    if canvas_sidekick_rust::migration::needs_import(profile) {
        let spec = canvas_sidekick_rust::migration::discover()?;
        canvas_sidekick_rust::migration::transfer(profile, &spec)?;
    }
    let settings = profile.settings()?;
    let mut state: State = profile.read("state.json")?;
    for item in &mut state.items {
        if item.is_manual {
            item.is_custom = true;
        }
    }
    let schedule =
        std::fs::read_to_string(profile.data_dir().join("schedule.txt")).unwrap_or_default();
    let session = Credentials::new(&profile.root).load()?;
    Ok(BootData {
        settings,
        state,
        schedule,
        session,
    })
}
enum Event {
    Boot(Result<BootData, String>),
    PollDue,
    Auth(Result<Value, String>),
    Fetched(Result<Vec<Item>, String>, bool),
    CredentialError(String),
    SessionUpdated(Value),
    StartupStatus(bool),
    Estimate(String, Result<Value, String>),
    OllamaCheck(u64, bool, bool),
    Pull(u64, u64),
    PullDone(u64, Result<(), String>),
    Chat(u64, Option<String>, Option<Value>),
}
#[derive(Clone)]
struct EventSender {
    inner: mpsc::Sender<Event>,
    wake: Arc<OnceLock<egui::Context>>,
}
impl EventSender {
    fn send(&self, event: Event) -> Result<(), mpsc::SendError<Event>> {
        let result = self.inner.send(event);
        if let Some(ctx) = self.wake.get() {
            ctx.request_repaint();
        }
        result
    }
}
#[derive(Default)]
struct CardState {
    revealed: bool,
    dragging: bool,
    offset: f32,
    height: f32,
    click: Option<Instant>,
    deleting: Option<Instant>,
}
#[derive(Default)]
struct Form {
    title: String,
    course: String,
    estimate: String,
    date: String,
    picker: NaiveDate,
    picker_open: bool,
    picker_month: Option<NaiveDate>,
    picker_hour: u32,
    picker_minute: u32,
    picker_scroll: bool,
    picker_years: bool,
    error: Option<String>,
}
pub struct App {
    profile: Arc<Profile>,
    settings: Settings,
    state: State,
    rt: tokio::runtime::Runtime,
    tx: EventSender,
    rx: mpsc::Receiver<Event>,
    canvas: Option<Canvas>,
    session: Option<Value>,
    authenticated: bool,
    checking: bool,
    migration_required: bool,
    loading: bool,
    fetching: bool,
    manual_sync: bool,
    sync_feedback_until: Option<Instant>,
    startup_enabled: bool,
    auth_waiting: bool,
    auth_success: Option<(Value, Instant)>,
    auth_url: String,
    error: Option<String>,
    tab: usize,
    last_fetch: Option<DateTime<Utc>>,
    poll_task: Option<tokio::task::JoinHandle<()>>,
    last_shape: Instant,
    attached: bool,
    resize_pending: bool,
    parent: Option<u64>,
    hosted: bool,
    host_rx: mpsc::Receiver<Value>,
    last_data: Option<Vec<Item>>,
    form: Option<Form>,
    card_states: HashMap<String, CardState>,
    estimating: HashSet<String>,
    schedule_text: String,
    courses: Vec<Course>,
    import_open: bool,
    import_schedule: bool,
    import_day: usize,
    import_status: Option<String>,
    import_status_until: Option<Instant>,
    month: NaiveDate,
    selected_day: Option<NaiveDate>,
    archive: Vec<Item>,
    update_course: String,
    ai_checking: bool,
    ai_generation: u64,
    ai_online: bool,
    ai_ready: bool,
    ai_pulling: bool,
    ai_progress: u64,
    messages: Vec<Value>,
    chat_input: String,
    typing: bool,
}
impl App {
    fn body_bottom(&self, ctx: &egui::Context) -> f32 {
        ctx.content_rect().bottom()
            - if self.settings.size == "Small" {
                13.
            } else {
                17.
            }
    }
    fn palette(&self) -> Palette {
        if self.hosted {
            Palette {
                background: Color32::from_rgb(234, 244, 238),
                text: Color32::from_rgb(25, 61, 48),
                on_primary: Color32::from_rgb(0, 66, 59),
                on_accent: Color32::WHITE,
                primary: Color32::from_rgb(0, 107, 95),
                success: Color32::from_rgb(20, 184, 166),
                error: Color32::from_rgb(186, 26, 26),
                card: Color32::from_rgb(252, 254, 253),
                muted: Color32::from_rgb(64, 92, 82),
                outline: Color32::from_rgb(199, 220, 208),
            }
        } else {
            Palette {
                background: Color32::BLACK,
                text: Color32::WHITE,
                on_primary: Color32::BLACK,
                on_accent: Color32::BLACK,
                primary: BLUE,
                success: GREEN,
                error: RED,
                card: CARD,
                muted: MUTED,
                outline: Color32::from_gray(51),
            }
        }
    }

    fn persist(&mut self) {
        if let Err(e) = self.profile.write("state.json", &self.state) {
            self.error = Some(e.to_string());
        }
    }
    fn save_settings(&mut self) {
        if let Err(e) = self.profile.write("settings.json", &self.settings) {
            self.error = Some(e.to_string());
        }
    }
    fn boot(&mut self) {
        self.checking = true;
        self.error = None;
        let profile = self.profile.clone();
        let tx = self.tx.clone();
        self.rt.spawn_blocking(move || {
            let _ = tx.send(Event::Boot(load_boot(&profile).map_err(|e| e.to_string())));
        });
    }
    fn start_polling(&mut self) {
        if let Some(task) = self.poll_task.take() {
            task.abort();
        }
        let tx = self.tx.clone();
        let seconds = 900;
        #[cfg(debug_assertions)]
        let seconds = std::env::var("CANVAS_SIDEKICK_POLL_SECONDS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(seconds)
            .max(1);
        self.poll_task = Some(self.rt.spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(seconds));
            interval.tick().await;
            loop {
                interval.tick().await;
                if tx.send(Event::PollDue).is_err() {
                    break;
                }
            }
        }));
    }
    fn fetch(&mut self, archive: bool) {
        if self.fetching {
            return;
        }
        let Some(canvas) = self.canvas.clone() else {
            return;
        };
        self.fetching = true;
        self.loading = !archive;
        let items = self.state.items.clone();
        let session = self.session.clone();
        let store = Credentials::new(&self.profile.root);
        let tx = self.tx.clone();
        self.rt.spawn(async move {
            let result = canvas.fetch(&items).await.map_err(|e| e.to_string());
            let snapshot = if result.is_ok() {
                session.and_then(|previous| {
                    canvas
                        .session_snapshot(&previous)
                        .ok()
                        .filter(|next| *next != previous)
                })
            } else {
                None
            };
            let _ = tx.send(Event::Fetched(result, archive));
            if let Some(snapshot) = snapshot {
                let saved = snapshot.clone();
                match tokio::task::spawn_blocking(move || store.save(&saved)).await {
                    Ok(Ok(())) => {
                        let _ = tx.send(Event::SessionUpdated(snapshot));
                    }
                    Ok(Err(error)) => {
                        let _ = tx.send(Event::CredentialError(error.to_string()));
                    }
                    Err(_) => {
                        let _ = tx.send(Event::CredentialError(
                            "Canvas session persistence was interrupted.".into(),
                        ));
                    }
                }
            }
        });
    }
    fn publish(&self) {
        if self.hosted && self.authenticated {
            let tasks:Vec<_>=self.state.items.iter().filter(|i|i.kind=="deadline").map(|i|json!({"id":i.id,"title":i.title,"course":i.course,"dueDate":i.due_date,"completed":i.completed,"schoolUrl":i.school_url.as_deref().unwrap_or(&self.settings.school_url)})).collect();
            println!("{}", json!({"v":1,"type":"tasks","tasks":tasks}));
        }
    }
    fn toggle(&mut self, id: &str) {
        if let Some(item) = self.state.items.iter_mut().find(|i| i.id == id) {
            item.completed = !item.completed;
            self.state.task_completion_overrides.insert(
                id.into(),
                Override {
                    completed: item.completed,
                    canvas_completed: item.canvas_completed.unwrap_or(false),
                },
            );
            self.persist();
            self.publish();
        }
    }
    fn add(&mut self, mut item: Item) {
        item.is_manual = true;
        item.is_custom = true;
        self.state.items.push(item);
        self.form = None;
        self.persist();
        self.publish();
        self.estimate_missing();
    }
    fn delete(&mut self, id: &str) {
        self.state.items.retain(|i| i.id != id);
        self.card_states.remove(id);
        self.state.task_completion_overrides.remove(id);
        self.persist();
        self.publish();
    }
    fn estimate_missing(&mut self) {
        for item in &self.state.items {
            if item.kind == "deadline"
                && item.time_estimate.is_none()
                && self.estimating.insert(item.id.clone())
            {
                let tx = self.tx.clone();
                let item = item.clone();
                self.rt.spawn(async move {
                    let result = Ollama::default()
                        .estimate_task(
                            &item.title,
                            item.due_date
                                .as_deref()
                                .or(item.date.as_deref())
                                .unwrap_or(""),
                        )
                        .await
                        .map_err(|e| e.to_string());
                    let _ = tx.send(Event::Estimate(item.id, result));
                });
            }
        }
    }
    fn check_ai(&mut self) {
        self.ai_checking = true;
        let generation = self.ai_generation;
        let tx = self.tx.clone();
        self.rt.spawn(async move {
            let ollama = Ollama::default();
            let online = ollama.version().await.is_ok();
            let ready = if online {
                ollama.tags().await.ok().is_some_and(|v| {
                    v["models"].as_array().is_some_and(|models| {
                        models
                            .iter()
                            .any(|m| m["name"].as_str().is_some_and(|s| s.contains("qwen2.5:3b")))
                    })
                })
            } else {
                false
            };
            let _ = tx.send(Event::OllamaCheck(generation, online, ready));
        });
    }
    fn login(&mut self) {
        if self.auth_waiting || self.auth_url.trim().is_empty() {
            return;
        }
        self.error = None;
        self.auth_waiting = true;
        let mut url = self.auth_url.trim().to_owned();
        if !url.starts_with("http") {
            url = format!("https://{url}");
        }
        let tx = self.tx.clone();
        let store = Credentials::new(&self.profile.root);
        self.rt.spawn_blocking(move || {
            let result = (|| -> anyhow::Result<Value> {
                Canvas::new(&url).map_err(|_| anyhow::anyhow!("Enter a valid Canvas URL."))?;
                let helper = std::env::current_exe()?.with_file_name(if cfg!(windows) {
                    "canvas-sidekick-auth.exe"
                } else {
                    "canvas-sidekick-auth"
                });
                let mut child = std::process::Command::new(helper)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .spawn()?;
                writeln!(child.stdin.take().unwrap(), "{}", json!({"url":url}))?;
                let output = child.wait_with_output()?;
                if !output.status.success() {
                    anyhow::bail!("Canvas could not be opened.");
                }
                let event: Value = output
                    .stdout
                    .split(|b| *b == b'\n')
                    .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
                    .find(|v| v["type"] == "authenticated" || v["type"] == "failed")
                    .ok_or_else(|| anyhow::anyhow!("Canvas login ended without a result"))?;
                if event["type"] != "authenticated" {
                    anyhow::bail!(
                        "{}",
                        match event["reason"].as_str() {
                            Some("timeout") => "Login timed out.",
                            Some("load-failed") => "Canvas could not be opened.",
                            Some("invalid-url") => "Enter a valid Canvas URL.",
                            _ => "Login was cancelled.",
                        }
                    );
                }
                store.save(&event)?;
                Ok(event)
            })();
            let _ = tx.send(Event::Auth(result.map_err(|e| e.to_string())));
        });
    }
    fn accept_session(&mut self, session: Value) {
        match Canvas::restore_session(&session) {
            Ok(canvas) => {
                self.settings.school_url = canvas.origin.clone();
                self.auth_url = canvas.origin.clone();
                self.canvas = Some(canvas);
                self.session = Some(session);
                self.last_data = None;
                self.authenticated = true;
                self.save_settings();
                self.publish();
                self.start_polling();
                self.fetch(false);
            }
            Err(error) => self.error = Some(error.to_string()),
        }
    }
    fn events(&mut self) {
        while let Ok(event) = self.rx.try_recv() {
            match event {
                Event::StartupStatus(enabled) => self.startup_enabled = enabled,
                Event::SessionUpdated(session) => self.session = Some(session),
                Event::CredentialError(error) => self.error = Some(error),
                Event::PollDue => {
                    if self.authenticated {
                        self.fetch(true);
                    }
                }
                Event::Boot(result) => {
                    self.checking = false;
                    match result {
                        Ok(data) => {
                            self.migration_required = false;
                            self.settings = data.settings;
                            self.state = data.state;
                            self.schedule_text = data.schedule;
                            self.courses = schedule::parse(&self.schedule_text);
                            self.auth_url = self.settings.school_url.clone();
                            if !self.hosted {
                                if let Some(ctx) = self.tx.wake.get() {
                                    ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(
                                        egui::Vec2::from(
                                            self.settings.dimensions(cfg!(target_os = "linux")),
                                        ) / ctx.zoom_factor(),
                                    ));
                                    self.resize_pending = true;
                                }
                            }
                            if let Some(session) = data.session {
                                self.checking = true;
                                self.accept_session(session);
                            }
                        }
                        Err(error) => self.error = Some(error),
                    }
                }
                Event::Auth(result) => {
                    self.auth_waiting = false;
                    match result {
                        Ok(session) => {
                            self.error = None;
                            self.auth_success =
                                Some((session, Instant::now() + Duration::from_millis(500)));
                        }
                        Err(e) => self.error = Some(e),
                    }
                }
                Event::Fetched(result, archive) => {
                    self.checking = false;
                    self.loading = false;
                    self.fetching = false;
                    if self.manual_sync {
                        self.manual_sync = false;
                        self.sync_feedback_until =
                            Some(Instant::now() + Duration::from_millis(800));
                    }

                    match result {
                        Ok(items) => {
                            self.last_fetch = Some(Utc::now());
                            if archive {
                                if let Err(e) = self.profile.archive(&items) {
                                    self.error = Some(e.to_string());
                                }
                            }
                            if !archive || self.last_data.as_ref() != Some(&items) {
                                if archive {
                                    self.last_data = Some(items.clone());
                                }
                                completion::merge(
                                    &mut self.state.items,
                                    items,
                                    &mut self.state.task_completion_overrides,
                                );
                                self.persist();
                                self.publish();
                                self.estimate_missing();
                            }
                        }
                        Err(e) => {
                            if e.contains("unauthorized") {
                                self.authenticated = false;
                                if let Some(task) = self.poll_task.take() {
                                    task.abort();
                                }
                                self.canvas = None;
                                let store = Credentials::new(&self.profile.root);
                                self.rt.spawn_blocking(move || {
                                    let _ = store.clear();
                                });
                            }
                            self.error = Some(e);
                        }
                    }
                }
                Event::Estimate(id, result) => match result {
                    Ok(v) => {
                        if let Some(item) = self.state.items.iter_mut().find(|i| i.id == id) {
                            item.time_estimate = Some(format!(
                                "{} hr ({})",
                                v["estimatedHours"],
                                v["difficulty"].as_str().unwrap_or("")
                            ));
                            self.persist();
                        }
                    }
                    Err(_) => {
                        self.estimating.remove(&id);
                    }
                },
                Event::OllamaCheck(generation, online, ready) => {
                    if generation != self.ai_generation || self.tab != 0 {
                        continue;
                    }
                    self.ai_checking = false;
                    self.ai_online = online;
                    self.ai_ready = ready;
                }
                Event::Pull(generation, p) => {
                    if generation == self.ai_generation && self.tab == 0 {
                        self.ai_progress = p;
                    }
                }
                Event::PullDone(generation, result) => {
                    if generation != self.ai_generation || self.tab != 0 {
                        continue;
                    }
                    self.ai_pulling = false;
                    match result {
                        Ok(()) => self.ai_ready = true,
                        Err(e) => self.error = Some(e),
                    }
                }
                Event::Chat(generation, reply, command) => {
                    let mut action = None;
                    if let Some(command) = command {
                        if command["intent"] == "add_task" {
                            if let Some(title) =
                                command["taskTitle"].as_str().filter(|s| !s.is_empty())
                            {
                                self.add(Item {
                                    id: Utc::now().timestamp_millis().to_string(),
                                    kind: "deadline".into(),
                                    title: title.into(),
                                    course: "Personal".into(),
                                    due_date: Some(
                                        command["taskDueDate"]
                                            .as_str()
                                            .filter(|s| !s.is_empty())
                                            .unwrap_or(&Utc::now().to_rfc3339())
                                            .into(),
                                    ),
                                    ..Default::default()
                                });
                                action = Some(format!("Added task: {title}"));
                            }
                        } else if command["intent"] == "delete_meeting" {
                            for item in &mut self.state.items {
                                if item.zoom_link.is_some()
                                    && item.timestamp().is_some_and(|d| {
                                        (d.with_timezone(&Utc) - Utc::now()).num_milliseconds()
                                            < 604800000
                                    })
                                {
                                    item.zoom_link = None;
                                }
                            }
                            self.persist();
                            action = Some(
                                "Zoom meetings for the next 7 days have been called off.".into(),
                            );
                        }
                    }
                    if generation != self.ai_generation || self.tab != 0 {
                        continue;
                    }
                    self.typing = false;
                    if let Some(reply) = reply.filter(|s| !s.is_empty()) {
                        self.messages
                            .push(json!({"role":"assistant","content":reply}));
                    } else if action.is_none() {
                        self.messages.push(
                            json!({"role":"assistant","content":"Sorry, I encountered an error."}),
                        );
                    }
                    if let Some(action) = action {
                        self.messages.push(
                            json!({"role":"assistant","content":format!("[System]: {action}")}),
                        );
                    }
                }
            }
        }
    }
    fn card_actions(&mut self) {
        let mut toggles = Vec::new();
        let mut deletes = Vec::new();
        for (id, state) in &mut self.card_states {
            if state.click.is_some_and(|when| Instant::now() >= when) {
                state.click = None;
                if state.revealed || state.offset < 0. {
                    state.revealed = false;
                    state.offset = 0.;
                } else {
                    toggles.push(id.clone());
                }
            }
            if state
                .deleting
                .is_some_and(|when| when.elapsed() >= Duration::from_millis(300))
            {
                deletes.push(id.clone());
            }
        }
        for id in toggles {
            self.toggle(&id);
        }
        for id in deletes {
            self.delete(&id);
        }
    }
    fn switch_tab(&mut self, index: usize) {
        if self.tab == index {
            return;
        }
        if !([2, 3].contains(&self.tab) && [2, 3].contains(&index)) {
            self.card_states.clear();
        }
        self.tab = index;
        if index == 0 {
            self.ai_generation += 1;
            self.chat_input.clear();
            self.typing = false;
            self.ai_pulling = false;
            self.ai_progress = 0;
            self.messages = vec![
                json!({"role":"assistant","content":"Hello! I am your AI assistant. How can I help you today?"}),
            ];
            self.check_ai();
        }
        if index == 1 {
            self.month = local_now().date_naive().with_day(1).unwrap();
            self.selected_day = None;
            self.import_open = false;
            self.import_day = 0;
            self.import_status = None;
            self.schedule_text =
                std::fs::read_to_string(self.profile.data_dir().join("schedule.txt"))
                    .unwrap_or_default();
        }
        if index == 4 {
            self.update_course = "All".into();
        }
        if index == 5 {
            let tx = self.tx.clone();
            self.rt.spawn_blocking(move || {
                let _ = tx.send(Event::StartupStatus(startup_status()));
            });
        }
    }
    fn save_schedule(&mut self) {
        if self.schedule_text.trim().is_empty() {
            self.schedule_text.clear();
        }
        self.import_status_until = Some(Instant::now() + Duration::from_secs(2));
        let parsed = schedule::parse(&self.schedule_text);
        if !self.schedule_text.trim().is_empty() && parsed.is_empty() {
            self.import_status = Some("Invalid format".into());
            return;
        }
        match canvas_sidekick_rust::storage::atomic_write(
            &self.profile.data_dir().join("schedule.txt"),
            self.schedule_text.as_bytes(),
        ) {
            Ok(()) => {
                self.courses = parsed;
                self.import_status = Some("Saved!".into());
            }
            Err(e) => self.error = Some(e.to_string()),
        }
    }
}
fn open_external(url: &str) {
    if !url::Url::parse(url).is_ok_and(|u| matches!(u.scheme(), "http" | "https")) {
        return;
    }
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .spawn();
}
fn startup_path() -> PathBuf {
    if let Some(directory) = std::env::var_os("CANVAS_SIDEKICK_TEST_AUTOSTART_DIR") {
        return PathBuf::from(directory).join("canvas-sidekick.desktop");
    }
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config")
        })
        .join("autostart/canvas-sidekick.desktop")
}
fn startup_status() -> bool {
    #[cfg(target_os = "linux")]
    return startup_path().exists();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("reg");
        command.creation_flags(0x08000000);
        return command
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "Canvas Sidekick",
            ])
            .output()
            .is_ok_and(|o| o.status.success());
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    false
}
fn startup_command() -> anyhow::Result<Vec<String>> {
    if let Ok(value) = std::env::var("CANVAS_SIDEKICK_STARTUP_COMMAND") {
        let command: Vec<String> = serde_json::from_str(&value)?;
        if command.is_empty() {
            anyhow::bail!("Missing startup executable");
        }
        return Ok(command);
    }
    Ok(vec![
        std::env::var_os("APPIMAGE")
            .or_else(|| std::env::var_os("CANVAS_SIDEKICK_PORTABLE_EXECUTABLE"))
            .map(PathBuf::from)
            .unwrap_or(std::env::current_exe()?)
            .to_string_lossy()
            .into_owned(),
    ])
}
fn set_startup(enabled: bool) -> anyhow::Result<()> {
    #[cfg(target_os = "linux")]
    {
        let path = startup_path();
        if enabled {
            let escaped = startup_command()?
                .iter()
                .map(|arg| {
                    let escaped = arg
                        .replace('\\', "\\\\")
                        .replace('"', "\\\"")
                        .replace('`', "\\`")
                        .replace('$', "\\$");
                    format!("\"{escaped}\"")
                })
                .collect::<Vec<_>>()
                .join(" ");
            canvas_sidekick_rust::storage::atomic_write(&path,format!("[Desktop Entry]\nType=Application\nVersion=1.0\nName=Canvas Sidekick\nComment=Canvas agenda and study assistant\nExec={escaped}\nTerminal=false\nStartupNotify=false\nX-GNOME-Autostart-enabled=true\nX-KDE-autostart-after=panel\n").as_bytes())?;
        } else if path.exists() {
            std::fs::remove_file(path)?;
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("reg");
        command.creation_flags(0x08000000);
        if enabled {
            command
                .args([
                    "add",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                    "/v",
                    "Canvas Sidekick",
                    "/t",
                    "REG_SZ",
                    "/d",
                ])
                .arg(
                    startup_command()?
                        .iter()
                        .map(|arg| {
                            let mut quoted = String::from("\"");
                            let mut slashes = 0;
                            for ch in arg.chars() {
                                if ch == '\\' {
                                    slashes += 1;
                                    continue;
                                }
                                if ch == '"' {
                                    quoted.push_str(&"\\".repeat(slashes * 2 + 1));
                                } else {
                                    quoted.push_str(&"\\".repeat(slashes));
                                }
                                quoted.push(ch);
                                slashes = 0;
                            }
                            quoted.push_str(&"\\".repeat(slashes * 2));
                            quoted.push('"');
                            quoted
                        })
                        .collect::<Vec<_>>()
                        .join(" "),
                )
                .arg("/f");
        } else {
            command.args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "Canvas Sidekick",
                "/f",
            ]);
        }
        if !command.output()?.status.success() {
            anyhow::bail!("Could not update launch-on-startup");
        }
    }
    Ok(())
}
impl eframe::App for App {
    fn clear_color(&self, _: &egui::Visuals) -> [f32; 4] {
        [0., 0., 0., 0.]
    }
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        if let Some((_, until)) = &self.auth_success {
            if Instant::now() >= *until {
                let (session, _) = self.auth_success.take().unwrap();
                self.accept_session(session);
            } else {
                ctx.request_repaint_after(until.saturating_duration_since(Instant::now()));
            }
        }
        if let Some(until) = self.import_status_until {
            if Instant::now() >= until {
                self.import_status = None;
                self.import_status_until = None;
            } else {
                ctx.request_repaint_after(until.saturating_duration_since(Instant::now()));
            }
        }
        if self.hosted && ctx.input(|i| i.viewport().close_requested()) {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
            println!("{}", json!({"v":1,"type":"close-request"}));
        }
        if ctx.input(|i| i.viewport().fullscreen).unwrap_or(false) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Fullscreen(false));
            ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(
                egui::Vec2::from(self.settings.dimensions(cfg!(target_os = "linux")))
                    / ctx.zoom_factor(),
            ));
        }
        self.events();
        if let Some(until) = self
            .sync_feedback_until
            .filter(|until| *until > Instant::now())
        {
            ctx.request_repaint_after(until.saturating_duration_since(Instant::now()));
        }
        self.card_actions();
        while let Ok(command) = self.host_rx.try_recv() {
            if self.hosted && command["v"] != 1 {
                continue;
            }
            match command["type"].as_str() {
                #[cfg(debug_assertions)]
                Some("test-view") => {
                    let mode = command["mode"].as_str().unwrap_or("normal");
                    self.auth_success = None;
                    self.auth_waiting = false;
                    self.error = None;
                    self.checking = false;
                    self.authenticated = true;
                    self.form = None;
                    self.import_open = false;
                    self.card_states.clear();
                    self.ai_generation += 1;
                    match mode {
                        "form" | "form-picker" => {
                            self.tab = 3;
                            self.form = Some(Form {
                                picker: local_now().date_naive(),
                                ..Default::default()
                            });
                            if mode == "form-picker" {
                                self.form.as_mut().unwrap().open_date_picker();
                            }
                        }
                        "import" | "schedule" => {
                            self.tab = 1;
                            self.import_open = true;
                            self.import_schedule = mode == "schedule";
                            self.import_day = 0;
                            self.import_status = None;
                            self.schedule_text = command["text"].as_str().unwrap_or("").into();
                            if command["text"].is_string() {
                                ctx.memory_mut(|m| m.request_focus(egui::Id::new("schedule-text")));
                            }
                        }
                        "day" => {
                            self.tab = 1;
                            self.selected_day = self
                                .state
                                .items
                                .iter()
                                .find(|i| i.kind == "deadline")
                                .and_then(|i| i.timestamp())
                                .map(|d| d.with_timezone(&Local).date_naive());
                        }
                        "auth-idle" | "auth-waiting" | "auth-error" | "auth-success" => {
                            self.authenticated = false;
                            self.auth_url = if mode == "auth-idle" {
                                String::new()
                            } else {
                                "canvas.example.edu".into()
                            };
                            self.auth_waiting = mode == "auth-waiting";
                            if mode == "auth-error" {
                                self.error = Some("Enter a valid Canvas URL.".into());
                            }
                            if mode == "auth-success" {
                                self.auth_success = self
                                    .session
                                    .clone()
                                    .map(|s| (s, Instant::now() + Duration::from_millis(500)));
                            }
                        }
                        "ai-offline" | "ai-model" | "ai-pull" => {
                            self.tab = 0;
                            self.ai_checking = false;
                            self.ai_online = mode != "ai-offline";
                            self.ai_ready = false;
                            self.ai_pulling = mode == "ai-pull";
                            self.ai_progress = 42;
                        }
                        _ => self.tab = 2,
                    }
                }
                #[cfg(debug_assertions)]
                Some("test-login") => {
                    if let Some(url) = command["url"].as_str() {
                        self.auth_url = url.into();
                        self.login();
                    }
                }
                #[cfg(debug_assertions)]
                Some("test-preferences") => {
                    if let Some(size) = command["size"].as_str() {
                        self.settings.size = size.into();
                    }
                    if let Some(text) = command["textSize"].as_str() {
                        self.settings.text_size = text.into();
                    }
                    self.settings.normalize();
                    if !self.hosted {
                        self.resize_pending = true;
                        self.last_shape = Instant::now() - Duration::from_secs(2);
                        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(
                            egui::Vec2::from(self.settings.dimensions(cfg!(target_os = "linux")))
                                / ctx.zoom_factor(),
                        ));
                    }
                }
                Some("bounds") => {
                    if let (Some(w), Some(h)) =
                        (command["width"].as_f64(), command["height"].as_f64())
                    {
                        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(egui::vec2(
                            w as f32 / ctx.zoom_factor(),
                            h as f32 / ctx.zoom_factor(),
                        )));
                    }
                    if let (Some(x), Some(y)) = (command["x"].as_f64(), command["y"].as_f64()) {
                        ctx.send_viewport_cmd(egui::ViewportCommand::OuterPosition(egui::pos2(
                            x as f32 / ctx.zoom_factor(),
                            y as f32 / ctx.zoom_factor(),
                        )));
                    }
                }
                Some("visible") => ctx.send_viewport_cmd(egui::ViewportCommand::Visible(
                    command["visible"].as_bool().unwrap_or(false),
                )),
                Some("toggle") => {
                    if let Some(id) = command["id"].as_str() {
                        self.toggle(id);
                    }
                }
                Some("tab") => {
                    if let Some(index) = command["index"].as_u64().filter(|i| *i < 6) {
                        self.switch_tab(index as usize);
                    }
                }
                Some("quit") => {
                    self.hosted = false;
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                }
                _ => {}
            }
        }
        if !self.attached || self.last_shape.elapsed() > Duration::from_secs(1) {
            if let Ok(handle) = frame.window_handle() {
                let xid = match handle.as_raw() {
                    RawWindowHandle::Xlib(h) => Some(h.window as u32),
                    RawWindowHandle::Xcb(h) => Some(h.window.get()),
                    RawWindowHandle::Win32(h) => {
                        if !self.attached {
                            #[cfg(target_os = "windows")]
                            canvas_sidekick_rust::windows_desktop::attach(
                                h.hwnd.get() as usize,
                                self.parent.map(|p| p as usize),
                            );
                            println!(
                                "{}",
                                json!({"v":1,"type":"ready","hwnd":(h.hwnd.get() as usize).to_string()})
                            );
                        }
                        None
                    }
                    _ => None,
                };
                if let Some(xid) = xid {
                    #[cfg(target_os = "linux")]
                    if self.parent.is_none() && (!self.attached || self.resize_pending) {
                        let native_scale = ctx.pixels_per_point() / ctx.zoom_factor();
                        if let Ok([x, y, w, h]) = canvas_sidekick_rust::desktop::fit(
                            xid,
                            self.settings.dimensions(true),
                            native_scale,
                            !self.attached,
                        ) {
                            let ppp = ctx.pixels_per_point();
                            ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(
                                egui::vec2(w, h) / ppp,
                            ));
                            ctx.send_viewport_cmd(egui::ViewportCommand::OuterPosition(
                                egui::pos2(x / ppp, y / ppp),
                            ));
                        }
                    }
                    #[cfg(target_os = "linux")]
                    if std::env::var("CANVAS_SIDEKICK_NATIVE_WAYLAND").as_deref() != Ok("1") {
                        if let Err(e) = canvas_sidekick_rust::desktop::shape(
                            xid,
                            ctx.pixels_per_point(),
                            self.parent.map(|p| p as u32),
                            !self.attached,
                        ) {
                            self.error = Some(e.to_string());
                        }
                    }
                    if !self.attached {
                        println!("{}", json!({"v":1,"type":"ready","xid":xid}));
                    }
                }
            }
            self.attached = true;
            self.resize_pending = false;
            self.last_shape = Instant::now();
        }
        let p = self.palette();
        let scale = if cfg!(target_os = "linux") {
            self.settings.text_scale()
        } else {
            1.
        };
        let mut style = (*ctx.style()).clone();
        style.visuals.interact_cursor = Some(egui::CursorIcon::PointingHand);
        style.text_styles.insert(
            egui::TextStyle::Body,
            egui::FontId::proportional(14. * scale),
        );
        style.text_styles.insert(
            egui::TextStyle::Button,
            egui::FontId::proportional(13. * scale),
        );
        style.visuals.override_text_color = Some(p.text);
        style.visuals.selection.bg_fill = p.success;
        style.visuals.selection.stroke.color = p.on_primary;
        style.visuals.extreme_bg_color = p.card;
        style.visuals.widgets.inactive.bg_fill = p.card;
        style.visuals.widgets.inactive.fg_stroke.color = p.muted;
        style.visuals.widgets.hovered.bg_fill = p.card;
        style.visuals.widgets.hovered.fg_stroke.color = p.text;
        style.visuals.widgets.active.bg_fill = p.success;
        style.visuals.widgets.active.fg_stroke.color = p.on_primary;
        style.visuals.panel_fill = p.background;
        style.visuals.window_fill = p.card;
        style.visuals.widgets.inactive.corner_radius = egui::CornerRadius::same(14);
        style.spacing.item_spacing = egui::vec2(8., 8.);
        ctx.set_style(style);
        egui::CentralPanel::default()
            .frame(
                egui::Frame::new()
                    .fill(p.background)
                    .stroke(egui::Stroke::new(1_f32, p.outline))
                    .corner_radius(if cfg!(target_os="linux")||self.hosted{24}else if self.settings.size=="Small"{40}else{28})
                    .inner_margin(egui::Margin {left:if cfg!(target_os="linux")&&self.settings.size!="Small"&&ctx.content_rect().width()<=310. {8}else{12},right:if cfg!(target_os="linux")&&self.settings.size!="Small"&&ctx.content_rect().width()<=310. {8}else{12},top:12,bottom:if self.settings.size=="Small"{12}else{16}}),
            )
            .show(ctx, |ui| {
                if self.hosted {
                    let painter=ui.painter().with_clip_rect(ctx.content_rect());
                    painter.add(screens::squircle(ctx.content_rect().shrink(0.5),24.,false,p.background,egui::Stroke::new(1_f32,p.outline)));
                    if self.authenticated&&!self.checking&&self.form.is_none(){
                        let compact=self.settings.size=="Small"||ctx.content_rect().width()<=310.;
                        let height=if compact{39.}else{45.};
                        let header=egui::Rect::from_min_size(ctx.content_rect().min+egui::vec2(1.,1.),egui::vec2(ctx.content_rect().width()-2.,height));
                        painter.add(screens::squircle(header,23.,true,Color32::from_rgb(242,248,244),egui::Stroke::NONE));
                        painter.hline(header.x_range(),header.bottom()-0.5,egui::Stroke::new(1_f32,Color32::from_rgb(204,222,211)));
                    }
                }
                if self.checking {
                    let center=ctx.content_rect().center();
                    ui.painter().circle_stroke(center,15.,egui::Stroke::new(4.5_f32,Color32::from_white_alpha(26)));
                    let angle=ui.input(|i|i.time) as f32*std::f32::consts::TAU;
                    let points=(0..=20).map(|i|{let angle=angle+i as f32/20.*std::f32::consts::FRAC_PI_2-std::f32::consts::FRAC_PI_2;center+egui::vec2(angle.cos(),angle.sin())*15.}).collect();
                    ui.painter().add(egui::Shape::line(points,egui::Stroke::new(4.5_f32,p.primary)));
                    ctx.request_repaint();
                    return;
                }
                if self.migration_required{
                    ui.vertical_centered(|ui|{
                        ui.add_space(40.);ui.heading("Transfer existing data");
                        ui.label("Close Canvas Sidekick and Command Center so your tasks, settings, schedule, archives, and login can be transferred.");
                        if let Some(error)=&self.error{ui.colored_label(p.error,error);}
                        if ui.button("Retry transfer").clicked(){self.boot();}
                        if ui.button("Close").clicked(){ui.ctx().send_viewport_cmd(egui::ViewportCommand::Close);}
                    });
                    return;
                }
                if !self.authenticated {
                    self.auth(ui);
                    return;
                }
                if self.form.is_some() {
                    egui::ScrollArea::vertical().scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden).show(ui, |ui| self.task_form(ui));
                    return;
                }
                self.header(ui);
                let show_add = self.tab == 2 || self.tab == 3;
                let height = ui.available_height();
                if self.tab == 0 {
                    let padding=if cfg!(target_os="linux"){8}else if self.settings.size=="Small"{4}else{12};
                    egui::Frame::new()
                        .fill(p.card)
                        .corner_radius(16)
                        .inner_margin(padding)
                        .show(ui, |ui| {
                            ui.set_min_width(ui.available_width());
                            ui.set_height(height.max(if cfg!(target_os="linux"){240.}else{0.}) - 2.*padding as f32);
                            self.ai(ui);
                        });
                } else {
                    egui::ScrollArea::vertical().scroll_bar_visibility(egui::scroll_area::ScrollBarVisibility::AlwaysHidden)
                        .id_salt(("content", self.tab))
                        .max_height(height.max(40.))
                        .show(ui, |ui| {
                            ui.set_min_width(ui.available_width());
                            match self.tab {
                                0 => self.ai(ui),
                                1 => self.calendar(ui),
                                5 => self.settings_screen(ui),
                                _ => self.agenda(ui),
                            }
                        });
                }
                if show_add {
                    let small=self.settings.size=="Small";
                    let size=if small {32.}else{36.};let inset=if small {9.}else{17.};
                    let content_rect=ctx.content_rect();
                    let hover=ctx.input(|i|i.pointer.hover_pos().is_some_and(|p|content_rect.contains(p)));
                    let opacity=ctx.animate_bool_with_time(egui::Id::new("fab-hover"),hover,0.3);
                    let rect=egui::Rect::from_min_size(ctx.content_rect().right_bottom()-egui::vec2(inset+size,inset+size-10.*(1.-opacity)),egui::vec2(size,size));
                    let mut fab_ui=ui.new_child(egui::UiBuilder::new().id_salt("fab-overlay").max_rect(rect));
                        fab_ui.set_opacity(opacity);
                        if fab_ui
                            .put(rect,
                                egui::Button::image(egui::Image::new(egui::include_image!("../../assets/icons/add.svg")).tint(p.on_primary).fit_to_exact_size(egui::vec2(20.,20.)))
                                    .fill(if ctx.input(|i|i.pointer.hover_pos().is_some_and(|point|rect.contains(point))){p.primary}else{p.success})
                                    .corner_radius(100)
                                    .min_size(egui::vec2(size, size)),
                            )
                            .clicked() && hover
                        {
                            self.form = Some(Form {
                                picker: local_now().date_naive(),
                                ..Default::default()
                            });
                        }
                }
            });
        for state in self.card_states.values() {
            if let Some(when) = state.click {
                ctx.request_repaint_after(when.saturating_duration_since(Instant::now()));
            }
            if state.deleting.is_some() {
                ctx.request_repaint();
            }
        }
        ctx.request_repaint_after(Duration::from_secs(1));
    }
}
pub fn run() -> eframe::Result<()> {
    use std::io::BufRead;
    let mut profile = std::env::var_os("CANVAS_SIDEKICK_PROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            #[cfg(target_os = "windows")]
            let base = std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .unwrap_or_default();
            #[cfg(not(target_os = "windows"))]
            let base = std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config")
                });
            base.join("canvas-sidekick-rust")
        });
    let mut parent = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--profile" => {
                if let Some(path) = args.next() {
                    profile = path.into();
                }
            }
            "--hosted-parent" => parent = args.next().and_then(|v| v.parse().ok()),
            _ => {}
        }
    }
    let profile =
        Arc::new(Profile::open(profile).map_err(|e| eframe::Error::AppCreation(e.into()))?);
    let settings = profile
        .settings()
        .map_err(|e| eframe::Error::AppCreation(e.into()))?;
    let state: State = profile
        .read("state.json")
        .map_err(|e| eframe::Error::AppCreation(e.into()))?;
    let schedule_text =
        std::fs::read_to_string(profile.data_dir().join("schedule.txt")).unwrap_or_default();
    let courses = schedule::parse(&schedule_text);
    let auth_url = settings.school_url.clone();
    let dimensions = settings.dimensions(cfg!(target_os = "linux"));
    let (event_tx, rx) = mpsc::channel();
    let wake = Arc::new(OnceLock::<egui::Context>::new());
    let tx = EventSender {
        inner: event_tx,
        wake: wake.clone(),
    };
    let host_wake = wake.clone();
    let (host_tx, host_rx) = mpsc::channel();
    let close_on_eof = parent.is_some();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if host_tx.send(value).is_err() {
                    break;
                }
                if let Some(ctx) = host_wake.get() {
                    ctx.request_repaint();
                }
            }
        }
        if close_on_eof {
            let _ = host_tx.send(json!({"v":1,"type":"quit"}));
            if let Some(ctx) = host_wake.get() {
                ctx.request_repaint();
            }
        }
    });
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|e| eframe::Error::AppCreation(e.into()))?;
    let migration_required = canvas_sidekick_rust::migration::needs_import(&profile);
    #[cfg(target_os = "windows")]
    if parent.is_none() {
        set_startup(true).map_err(|e| eframe::Error::AppCreation(e.into()))?;
    }
    let boot_profile = profile.clone();
    let initial_tx = tx.clone();
    rt.spawn_blocking(move || {
        let _ = initial_tx.send(Event::Boot(
            load_boot(&boot_profile).map_err(|e| e.to_string()),
        ));
    });
    let mut options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size(dimensions)
            .with_app_id("canvas-sidekick")
            .with_icon(
                eframe::icon_data::from_png_bytes(include_bytes!("../../assets/app-icon.png"))
                    .unwrap_or_default(),
            )
            .with_visible(parent.is_none())
            .with_decorations(false)
            .with_transparent(true)
            .with_resizable(false)
            .with_taskbar(false)
            .with_minimize_button(false)
            .with_maximize_button(false),
        ..Default::default()
    };
    #[cfg(target_os = "linux")]
    if std::env::var("CANVAS_SIDEKICK_NATIVE_WAYLAND").as_deref() != Ok("1") {
        use winit::platform::x11::EventLoopBuilderExtX11;
        options.event_loop_builder = Some(Box::new(|builder| {
            builder.with_x11();
        }));
    }
    eframe::run_native(
        "Canvas Sidekick",
        options,
        Box::new(move |cc| {
            #[cfg(target_os = "windows")]
            if parent.is_none() {
                cc.egui_ctx.set_zoom_factor(0.75);
            }
            let _ = wake.set(cc.egui_ctx.clone());
            egui_extras::install_image_loaders(&cc.egui_ctx);
            cc.egui_ctx.set_visuals(egui::Visuals::dark());
            let mut fonts = egui::FontDefinitions::default();
            let hosted = parent.is_some();
            let faces: [(&str, &[u8]); 4] = if hosted {
                [
                    (
                        "regular",
                        include_bytes!("../../assets/fonts/Manrope-Regular.ttf"),
                    ),
                    (
                        "medium",
                        include_bytes!("../../assets/fonts/Manrope-Medium.ttf"),
                    ),
                    (
                        "semibold",
                        include_bytes!("../../assets/fonts/Manrope-Semibold.ttf"),
                    ),
                    (
                        "bold",
                        include_bytes!("../../assets/fonts/Manrope-Bold.ttf"),
                    ),
                ]
            } else {
                [
                    (
                        "regular",
                        include_bytes!("../../assets/fonts/Noto-Regular.ttf"),
                    ),
                    (
                        "medium",
                        include_bytes!("../../assets/fonts/Noto-Medium.ttf"),
                    ),
                    (
                        "semibold",
                        include_bytes!("../../assets/fonts/Noto-Semibold.ttf"),
                    ),
                    ("bold", include_bytes!("../../assets/fonts/Noto-Bold.ttf")),
                ]
            };
            for (name, bytes) in faces {
                let data = bytes.to_vec();
                #[cfg(target_os = "windows")]
                let data = if !hosted {
                    let path = match name {
                        "regular" => r"C:\Windows\Fonts\segoeui.ttf",
                        "medium" | "semibold" => r"C:\Windows\Fonts\seguisb.ttf",
                        _ => r"C:\Windows\Fonts\segoeuib.ttf",
                    };
                    std::fs::read(path).unwrap_or(data)
                } else {
                    data
                };
                fonts
                    .font_data
                    .insert(name.into(), Arc::new(egui::FontData::from_owned(data)));
                let fallback = fonts
                    .families
                    .get(&egui::FontFamily::Proportional)
                    .cloned()
                    .unwrap_or_default();
                let mut family = vec![name.into()];
                family.extend(fallback);
                fonts
                    .families
                    .insert(egui::FontFamily::Name(name.into()), family);
            }
            fonts
                .families
                .entry(egui::FontFamily::Proportional)
                .or_default()
                .insert(0, "regular".into());
            let mono = include_bytes!("../../assets/fonts/NotoMono-Regular.ttf").to_vec();
            #[cfg(target_os = "windows")]
            let mono = std::fs::read(r"C:\Windows\Fonts\consola.ttf").unwrap_or(mono);
            fonts
                .font_data
                .insert("mono".into(), Arc::new(egui::FontData::from_owned(mono)));
            fonts
                .families
                .entry(egui::FontFamily::Monospace)
                .or_default()
                .insert(0, "mono".into());
            cc.egui_ctx.set_fonts(fonts);
            Ok(Box::new(App {
                profile,
                settings,
                state,
                rt,
                tx,
                rx,
                canvas: None,
                session: None,
                authenticated: false,
                checking: true,
                migration_required,
                loading: false,
                fetching: false,
                manual_sync: false,
                sync_feedback_until: None,
                startup_enabled: false,
                auth_waiting: false,
                auth_success: None,
                auth_url,
                error: None,
                tab: 2,
                last_fetch: None,
                poll_task: None,
                last_shape: Instant::now(),
                attached: false,
                resize_pending: true,
                parent,
                hosted: parent.is_some(),
                host_rx,
                last_data: None,
                form: None,
                card_states: HashMap::new(),
                estimating: HashSet::new(),
                schedule_text,
                courses,
                import_open: false,
                import_schedule: false,
                import_day: 0,
                import_status: None,
                import_status_until: None,
                month: local_now().date_naive().with_day(1).unwrap(),
                selected_day: None,
                archive: Vec::new(),
                update_course: "All".into(),
                ai_checking: true,
                ai_generation: 0,
                ai_online: false,
                ai_ready: false,
                ai_pulling: false,
                ai_progress: 0,
                messages: Vec::new(),
                chat_input: String::new(),
                typing: false,
            }))
        }),
    )
}

#[cfg(test)]
mod tests;
