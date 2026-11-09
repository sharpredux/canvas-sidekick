//! Read a session on a private pipe and report only aggregate read-only Canvas results.
use canvas_sidekick_rust::canvas::Canvas;
use std::io::{self, BufRead, IsTerminal};
#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    if io::stdin().is_terminal() {
        anyhow::bail!("Session must use a private pipe");
    }
    let line = io::stdin()
        .lock()
        .lines()
        .next()
        .ok_or_else(|| anyhow::anyhow!("Missing session"))??;
    let session: serde_json::Value = serde_json::from_str(&line)?;
    let data = Canvas::restore_session(&session)?.fetch(&[]).await?;
    println!(
        "{}",
        serde_json::json!({"items":data.len(),"deadlines":data.iter().filter(|i|i.kind=="deadline").count(),"events":data.iter().filter(|i|i.kind=="event").count(),"updates":data.iter().filter(|i|matches!(i.kind.as_str(),"announcement"|"comment")).count()})
    );
    Ok(())
}
