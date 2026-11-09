use crate::{
    completion::{Override, Overrides},
    model::{Item, Settings},
};
use anyhow::{Context, Result, bail};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static SERIAL: AtomicU64 = AtomicU64::new(0);
#[derive(Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct State {
    pub items: Vec<Item>,
    pub task_completion_overrides: Overrides,
}
pub struct Profile {
    pub root: PathBuf,
    _lock: File,
}
impl Profile {
    pub fn open(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root)?;
        let root = fs::canonicalize(root)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join("profile.lock"))?;
        lock.try_lock_exclusive()
            .context("This Rust Sidekick profile is already open")?;
        Ok(Self { root, _lock: lock })
    }
    pub fn data_dir(&self) -> PathBuf {
        let imported = self.root.join("imported");
        if imported.is_dir() {
            imported
        } else {
            self.root.clone()
        }
    }
    pub fn read<T: serde::de::DeserializeOwned + Default>(&self, name: &str) -> Result<T> {
        let path = self.data_dir().join(name);
        match fs::read(&path) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)
                .with_context(|| format!("Invalid {}", path.display()))?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
            Err(e) => Err(e.into()),
        }
    }
    pub fn write<T: Serialize>(&self, name: &str, value: &T) -> Result<()> {
        atomic_write(
            &self.data_dir().join(name),
            &serde_json::to_vec_pretty(value)?,
        )
    }
    pub fn settings(&self) -> Result<Settings> {
        let mut settings: Settings = self.read("settings.json")?;
        settings.normalize();
        Ok(settings)
    }
    pub fn archive(&self, items: &[Item]) -> Result<()> {
        for item in items.iter().filter(|i| i.kind == "deadline" && i.completed) {
            let Some(date) = item.timestamp() else {
                continue;
            };
            let name = format!(
                "archive/{}.json",
                date.with_timezone(&chrono::Utc).format("%Y-%m-%d")
            );
            let mut entries: Vec<Item> = self.read(&name)?;
            if !entries.iter().any(|e| e.id == item.id) {
                entries.push(item.clone());
                self.write(&name, &entries)?;
            }
        }
        Ok(())
    }
    /// Validate before writing, then commit the complete nonsecret import with one rename.
    /// Credentials are transferred through the credential store, never this export.
    pub fn import_legacy(&self, export: &serde_json::Value) -> Result<()> {
        if self.root.join("imported").exists() {
            bail!("Profile has already been migrated");
        }
        for name in ["state.json", "settings.json", "schedule.txt", "archive"] {
            if self.root.join(name).exists() {
                bail!("Import requires an empty Rust profile");
            }
        }
        let mut settings: Settings = serde_json::from_value(export["settings"].clone())?;
        settings.normalize();
        let items: Vec<Item> = serde_json::from_value(export["manualTasks"].clone())?;
        let overrides: Overrides = if export["taskCompletionOverrides"].is_object() {
            serde_json::from_value(export["taskCompletionOverrides"].clone())?
        } else {
            export["localCompletedIds"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|id| id.as_str())
                .map(|id| {
                    (
                        id.into(),
                        Override {
                            completed: true,
                            canvas_completed: items
                                .iter()
                                .find(|i| i.id == id)
                                .and_then(|i| i.canvas_completed)
                                .unwrap_or(false),
                        },
                    )
                })
                .collect()
        };
        let mut files = vec![
            (
                "settings.json".to_owned(),
                serde_json::to_vec_pretty(&settings)?,
            ),
            (
                "schedule.txt".to_owned(),
                export["schedule"]
                    .as_str()
                    .unwrap_or("")
                    .as_bytes()
                    .to_vec(),
            ),
            (
                "state.json".to_owned(),
                serde_json::to_vec_pretty(&State {
                    items,
                    task_completion_overrides: overrides,
                })?,
            ),
            (
                "migration.json".to_owned(),
                serde_json::to_vec(&serde_json::json!({"version":1,"source":"electron"}))?,
            ),
        ];
        if let Some(archives) = export["archives"].as_object() {
            for (date, data) in archives {
                if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_err() || date.len() != 10
                {
                    bail!("Invalid archive date");
                }
                let entries: Vec<Item> = serde_json::from_value(data.clone())?;
                files.push((
                    format!("archive/{date}.json"),
                    serde_json::to_vec_pretty(&entries)?,
                ));
            }
        }
        let staging = self.root.join(format!(
            ".import-{}-{}",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&staging)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))?;
        }
        let result = (|| -> Result<()> {
            for (name, bytes) in files {
                atomic_write(&staging.join(name), &bytes)?;
            }
            fs::rename(&staging, self.root.join("imported"))?;
            #[cfg(unix)]
            File::open(&self.root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&staging);
        }
        result
    }
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    let result = (|| -> Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        #[cfg(unix)]
        if let Some(parent) = path.parent() {
            File::open(parent)?.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
