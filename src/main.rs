#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod ui;
fn main() -> eframe::Result<()> {
    ui::run()
}
