use canvas_sidekick_rust::{completion, model::Item};
use serde_json::{Value, json};
use std::io::{self, BufRead};
fn main() -> anyhow::Result<()> {
    for line in io::stdin().lock().lines() {
        let v: Value = serde_json::from_str(&line?)?;
        let result = match v["op"].as_str().unwrap_or("") {
            "completed" => json!(completion::is_assignment_completed(
                &v["assignment"],
                v.get("submission")
            )),
            "apply" => {
                let item: Item = serde_json::from_value(v["item"].clone())?;
                let previous: Option<Item> = v
                    .get("previous")
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()?;
                let mut overrides: completion::Overrides =
                    serde_json::from_value(v["overrides"].clone())?;
                let item = completion::apply(item, &mut overrides, previous.as_ref());
                json!({"completed":item.completed,"canvasCompleted":item.canvas_completed,"overrides":overrides})
            }
            "view" => {
                let items: Vec<Item> = serde_json::from_value(v["items"].clone())?;
                let schedule: Vec<canvas_sidekick_rust::schedule::Course> =
                    serde_json::from_value(v["schedule"].clone())?;
                let now = chrono::DateTime::parse_from_rfc3339(v["now"].as_str().unwrap())?;
                json!(
                    canvas_sidekick_rust::view::filtered(
                        &items,
                        v["tab"].as_str().unwrap(),
                        &schedule,
                        now
                    )
                    .iter()
                    .map(|i| json!({"id":i.id,"zoomLink":i.zoom_link}))
                    .collect::<Vec<_>>()
                )
            }
            "schedule" => serde_json::to_value(canvas_sidekick_rust::schedule::parse(
                v["raw"].as_str().unwrap_or(""),
            ))?,
            _ => anyhow::bail!("unknown operation"),
        };
        println!("{}", result);
    }
    Ok(())
}
