//! Native-window compatibility gate. This is deliberately not a replacement app yet.
use eframe::egui;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::{Value, json};
use std::{
    io::BufRead,
    sync::mpsc,
    time::{Duration, Instant},
};
struct Gate {
    size: String,
    rx: mpsc::Receiver<Value>,
    last_shape: Instant,
    native: bool,
    parent: Option<u32>,
    quit_after: Option<Instant>,
    error: Option<String>,
}
#[cfg(target_os = "linux")]
use canvas_sidekick_rust::desktop::shape;

impl eframe::App for Gate {
    fn clear_color(&self, _: &egui::Visuals) -> [f32; 4] {
        [0., 0., 0., 0.]
    }
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        for command in self.rx.try_iter() {
            match command["type"].as_str() {
                Some("bounds") => {
                    if let (Some(w), Some(h)) =
                        (command["width"].as_f64(), command["height"].as_f64())
                    {
                        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(egui::vec2(
                            w as f32, h as f32,
                        )));
                    }
                    if let (Some(x), Some(y)) = (command["x"].as_f64(), command["y"].as_f64()) {
                        ctx.send_viewport_cmd(egui::ViewportCommand::OuterPosition(egui::pos2(
                            x as f32, y as f32,
                        )));
                    }
                }
                Some("visible") => ctx.send_viewport_cmd(egui::ViewportCommand::Visible(
                    command["visible"].as_bool().unwrap_or(false),
                )),
                Some("quit") => ctx.send_viewport_cmd(egui::ViewportCommand::Close),
                _ => {}
            }
        }
        if self.quit_after.is_some_and(|t| Instant::now() >= t) {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
        if !self.native || self.last_shape.elapsed() > Duration::from_secs(1) {
            if let Ok(handle) = frame.window_handle() {
                match handle.as_raw() {
                    RawWindowHandle::Xlib(h) => {
                        let xid = h.window as u32;
                        if !self.native {
                            println!("{}", json!({"type":"ready","xid":xid}));
                        }
                        #[cfg(target_os = "linux")]
                        if let Err(e) =
                            shape(xid, ctx.pixels_per_point(), self.parent, !self.native)
                        {
                            self.error = Some(e.to_string());
                        }
                    }
                    RawWindowHandle::Xcb(h) => {
                        let xid = h.window.get();
                        if !self.native {
                            println!("{}", json!({"type":"ready","xid":xid}));
                        }
                        #[cfg(target_os = "linux")]
                        if let Err(e) =
                            shape(xid, ctx.pixels_per_point(), self.parent, !self.native)
                        {
                            self.error = Some(e.to_string());
                        }
                    }
                    _ => {
                        if !self.native {
                            println!("{}", json!({"type":"ready","backend":"non-X11"}));
                        }
                    }
                }
            }
            self.native = true;
            self.last_shape = Instant::now();
        }
        egui::CentralPanel::default()
            .frame(
                egui::Frame::new()
                    .fill(egui::Color32::BLACK)
                    .corner_radius(24)
                    .inner_margin(12),
            )
            .show(ctx, |ui| {
                let drag = ui
                    .horizontal(|ui| {
                        ui.label(
                            egui::RichText::new("Canvas Sidekick")
                                .color(egui::Color32::from_rgb(50, 173, 230)),
                        );
                        if ui.button("×").clicked() {
                            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                        }
                    })
                    .response;
                if drag.interact(egui::Sense::drag()).drag_started() {
                    ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
                }
                ui.separator();
                ui.label("Native window compatibility gate");
                ui.label("The Electron app is still the production app.");
                ui.horizontal(|ui| {
                    for size in ["Small", "Medium", "Large"] {
                        if ui.selectable_label(self.size == size, size).clicked() {
                            self.size = size.into();
                            let settings = canvas_sidekick_rust::model::Settings {
                                size: self.size.clone(),
                                ..Default::default()
                            };
                            ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(
                                settings.dimensions(cfg!(target_os = "linux")).into(),
                            ));
                            self.last_shape = Instant::now() - Duration::from_secs(2);
                        }
                    }
                });
                if let Some(e) = &self.error {
                    ui.colored_label(egui::Color32::RED, e);
                }
            });
        ctx.request_repaint_after(Duration::from_millis(250));
    }
}
fn main() -> eframe::Result<()> {
    let mut args = std::env::args().skip(1);
    let mut parent = None;
    let mut seconds = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--parent" => parent = args.next().and_then(|v| v.parse().ok()),
            "--seconds" => seconds = args.next().and_then(|v| v.parse::<u64>().ok()),
            _ => {}
        }
    }
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if tx.send(value).is_err() {
                    break;
                }
            }
        }
    });
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([360., 520.])
            .with_decorations(false)
            .with_transparent(true)
            .with_resizable(false)
            .with_taskbar(false),
        ..Default::default()
    };
    eframe::run_native(
        "Canvas Sidekick — native gate",
        options,
        Box::new(move |cc| {
            cc.egui_ctx.set_visuals(egui::Visuals::dark());
            Ok(Box::new(Gate {
                size: "Medium".into(),
                rx,
                last_shape: Instant::now(),
                native: false,
                parent,
                quit_after: seconds.map(|s| Instant::now() + Duration::from_secs(s)),
                error: None,
            }))
        }),
    )
}
