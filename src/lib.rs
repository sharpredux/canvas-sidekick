pub mod canvas;
pub mod completion;
pub mod model;
pub mod ollama;
pub mod schedule;
pub mod storage;

pub mod view;
pub mod window_geometry;

pub mod credentials;

#[cfg(feature = "desktop")]
pub mod desktop;

#[cfg(target_os = "windows")]
pub mod windows_desktop;

pub mod migration;
