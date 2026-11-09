//! One-time migration through the old Electron runtime, with a snapshot and private pipes.
use crate::{canvas::Canvas, credentials::Credentials, storage::Profile};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
#[derive(Clone)]
pub struct Legacy {
    pub source: PathBuf,
    pub renderer: PathBuf,
    pub electron: PathBuf,
    pub exporter: PathBuf,
}
pub fn legacy_profile() -> PathBuf {
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
    base.join("canvas-sidekick")
}
pub fn needs_import(profile: &Profile) -> bool {
    let old = legacy_profile();
    !["imported", "state.json", "settings.json"]
        .iter()
        .any(|name| profile.root.join(name).exists())
        && ["settings.json", "canvas_cookie", "Local Storage"]
            .iter()
            .any(|name| old.join(name).exists())
}
pub fn discover() -> Result<Legacy> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let helper = std::env::current_exe()?
        .parent()
        .context("Missing application directory")?
        .join("migration/legacy-export.cjs");
    let exporter = if helper.exists() {
        helper
    } else {
        root.join("tools/legacy-export.cjs")
    };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("CANVAS_SIDEKICK_LEGACY_ELECTRON") {
        candidates.push(PathBuf::from(path));
    }
    #[cfg(target_os = "linux")]
    candidates.push(PathBuf::from("/opt/Canvas Sidekick/canvas-sidekick"));
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Programs/Canvas Sidekick/Canvas Sidekick.exe"));
    }
    candidates.push(root.parent().unwrap_or(&root).join(if cfg!(windows) {
        "canvas-sidekick/node_modules/electron/dist/electron.exe"
    } else {
        "canvas-sidekick/node_modules/electron/dist/electron"
    }));
    let electron=candidates.into_iter().find(|p|p.is_file()).context("Locate the existing Canvas Sidekick runtime before transferring its data (CANVAS_SIDEKICK_LEGACY_ELECTRON)")?;
    let installed = electron
        .parent()
        .context("Missing legacy runtime directory")?
        .join("resources/app.asar/dist/index.html");
    // Electron transparently opens files inside ASAR archives; std::fs cannot stat those files.
    let renderer = if electron
        .parent()
        .unwrap()
        .join("resources/app.asar")
        .exists()
    {
        installed
    } else {
        root.parent()
            .unwrap_or(&root)
            .join("canvas-sidekick/dist/index.html")
    };
    Ok(Legacy {
        source: legacy_profile(),
        renderer,
        electron,
        exporter,
    })
}
fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let dest = target.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}
struct Runtime {
    executable: PathBuf,
    _temporary: Option<tempfile::TempDir>,
}
fn prepare_runtime(spec: &Legacy, profile: &Profile) -> Result<Runtime> {
    let directory = spec
        .electron
        .parent()
        .context("Legacy runtime has no directory")?;
    if !directory.join("resources/app.asar").exists() && !directory.join("resources/app").exists() {
        return Ok(Runtime {
            executable: spec.electron.clone(),
            _temporary: None,
        });
    }
    // A packaged Electron executable always runs its bundled app. Give a temporary copy
    // a migration-only resources/app; leave the installed application untouched.
    let temporary = tempfile::Builder::new()
        .prefix(".migration-runtime-")
        .tempdir_in(&profile.root)?;
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        if entry.file_name() == "resources" {
            continue;
        }
        let dest = temporary.path().join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest)?;
        }
    }
    let app = temporary.path().join("resources/app");
    fs::create_dir_all(&app)?;
    fs::write(
        app.join("package.json"),
        br#"{"name":"canvas-sidekick","version":"0.1.7","main":"export.cjs"}"#,
    )?;
    fs::copy(&spec.exporter, app.join("export.cjs"))?;
    let executable = temporary.path().join(
        spec.electron
            .file_name()
            .context("Missing legacy executable filename")?,
    );
    Ok(Runtime {
        executable,
        _temporary: Some(temporary),
    })
}
pub fn transfer(profile: &Profile, spec: &Legacy) -> Result<usize> {
    if profile.root.join("imported").exists() {
        bail!("This profile has already been migrated");
    }
    let store = Credentials::new(&profile.root);
    let previous = store.load()?;
    let runtime = prepare_runtime(spec, profile)?;
    let snapshot = tempfile::Builder::new()
        .prefix(".migration-snapshot-")
        .tempdir_in(&profile.root)?;
    let mut child = Command::new(&runtime.executable)
        .arg(&spec.exporter)
        .env_remove("ELECTRON_RUN_AS_NODE")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Could not launch the one-time legacy export bridge")?;
    writeln!(
        child
            .stdin
            .take()
            .context("Legacy export input unavailable")?,
        "{}",
        json!({"profile":spec.source,"renderer":spec.renderer,"snapshotRoot":snapshot.path()})
    )?;
    let output = child.wait_with_output()?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr)
            .lines()
            .find(|line| line.starts_with("Legacy migration failed:"))
            .map(str::to_owned)
            .unwrap_or("Legacy export failed; the source profile was left unchanged".into());
        bail!("{message}");
    }
    let mut export: Value = serde_json::from_slice(&output.stdout)
        .context("Legacy export returned an invalid payload")?;
    if export["version"] != 1 {
        bail!("Unsupported legacy export version");
    }
    let cookies = export
        .as_object_mut()
        .context("Invalid legacy export")?
        .remove("cookies")
        .unwrap_or(json!([]));
    let has_cookies = cookies.as_array().is_some_and(|c| !c.is_empty());
    if has_cookies {
        let origin = Canvas::new(
            export["settings"]["schoolUrl"]
                .as_str()
                .context("Legacy cookies have no Canvas origin")?,
        )?
        .origin;
        store.save(&json!({"origin":origin,"cookies":cookies,"userAgent":export["userAgent"]}))?;
    }
    if let Err(error) = profile.import_legacy(&export) {
        if has_cookies {
            if let Some(previous) = previous {
                store.save(&previous).context(
                    "Could not restore the previous credential entry after import failed",
                )?;
            } else {
                store.clear()?;
            }
        }
        return Err(error);
    }
    Ok(export["manualTasks"].as_array().map(Vec::len).unwrap_or(0))
}
