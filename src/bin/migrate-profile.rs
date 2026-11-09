//! One-time migration entrypoint; the desktop app uses the same implementation.
use anyhow::{Context, Result, bail};
use canvas_sidekick_rust::{
    migration::{self, Legacy},
    storage::Profile,
};
use serde_json::{Value, json};
use std::{
    io::{self, BufRead, IsTerminal},
    path::PathBuf,
};
fn main() -> Result<()> {
    if io::stdin().is_terminal() {
        bail!("Migration configuration must use a private input pipe");
    }
    let line = io::stdin()
        .lock()
        .lines()
        .next()
        .context("Missing migration configuration")??;
    let config: Value = serde_json::from_str(&line)?;
    let field = |name: &str| -> Result<PathBuf> {
        Ok(PathBuf::from(
            config[name]
                .as_str()
                .with_context(|| format!("Missing {name}"))?,
        ))
    };
    let profile = Profile::open(field("destination")?)?;
    let spec = Legacy {
        source: field("source")?,
        renderer: field("renderer")?,
        electron: field("electron")?,
        exporter: config["exporter"]
            .as_str()
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tools/legacy-export.cjs")
            }),
    };
    let count = migration::transfer(&profile, &spec)?;
    println!("{}", json!({"type":"migration-complete","items":count}));
    Ok(())
}
