use anyhow::Result;
use serde_json::{Value, json};
pub const ESTIMATOR_PROMPT: &str = "You are an expert Task Estimator. \nEvaluate task difficulty and time based on title and deadlines.\nRespond ONLY in JSON.\n\nExamples:\nUser: Title: \"Read Chapter 5\", Deadline: \"Next week\"\nOutput: {\"difficulty\": \"easy\", \"estimatedHours\": 2}\n\nUser: Title: \"Final Project Implementation\", Deadline: \"Tomorrow\"\nOutput: {\"difficulty\": \"hard\", \"estimatedHours\": 12}\n\nUser: Title: \"Weekly Quiz\", Deadline: \"In 2 days\"\nOutput: {\"difficulty\": \"medium\", \"estimatedHours\": 1}";
pub const MODEL: &str = "qwen2.5:3b";
#[derive(Clone)]
pub struct Ollama {
    client: reqwest::Client,
    base: String,
}
impl Default for Ollama {
    fn default() -> Self {
        Self {
            client: reqwest::Client::new(),
            base: {
                #[cfg(debug_assertions)]
                if let Ok(base) = std::env::var("CANVAS_SIDEKICK_OLLAMA_URL") {
                    return Self {
                        client: reqwest::Client::new(),
                        base,
                    };
                }
                "http://127.0.0.1:11434/api".into()
            },
        }
    }
}
impl Ollama {
    pub async fn estimate_task(&self, title: &str, deadline: &str) -> Result<Value> {
        let response=self.chat(json!([
            {"role":"system","content":ESTIMATOR_PROMPT},
            {"role":"user","content":format!("Title: \"{title}\", Deadline: \"{deadline}\"")}
        ]),Some(json!({"type":"object","properties":{"difficulty":{"type":"string","enum":["easy","medium","hard"]},"estimatedHours":{"type":"number"}},"required":["difficulty","estimatedHours"]}))).await?;
        Ok(serde_json::from_str(
            response["message"]["content"].as_str().unwrap_or(""),
        )?)
    }
    pub async fn version(&self) -> Result<Value> {
        Ok(self
            .client
            .get(format!("{}/version", self.base))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }
    pub async fn tags(&self) -> Result<Value> {
        Ok(self
            .client
            .get(format!("{}/tags", self.base))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }
    pub async fn chat(&self, messages: Value, format: Option<Value>) -> Result<Value> {
        let mut body = json!({"model":MODEL,"messages":messages,"stream":false});
        if let Some(f) = format {
            body["format"] = f;
        }
        Ok(self
            .client
            .post(format!("{}/chat", self.base))
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?)
    }
    pub async fn parse_command(&self, input: &str) -> Result<Value> {
        let result=self.chat(json!([{"role":"system","content":"You are a command router. Parse the user's intent into structured JSON. If the intent is 'add_task', extract the task details into 'taskTitle' and 'taskDueDate'."},{"role":"user","content":input}]),Some(json!({"type":"object","properties":{"intent":{"type":"string","enum":["delete_meeting","add_task","unknown"]},"details":{"type":"string"},"taskTitle":{"type":"string"},"taskDueDate":{"type":"string"}},"required":["intent"]}))).await?;
        Ok(serde_json::from_str(
            result["message"]["content"].as_str().unwrap_or(""),
        )?)
    }
    pub async fn pull(&self, mut progress: impl FnMut(u64)) -> Result<()> {
        let mut response = self
            .client
            .post(format!("{}/pull", self.base))
            .json(&json!({"name":MODEL}))
            .send()
            .await?
            .error_for_status()?;
        let mut buffer = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            buffer.extend_from_slice(&chunk);
            while let Some(i) = buffer.iter().position(|b| *b == b'\n') {
                let line: Vec<_> = buffer.drain(..=i).collect();
                let value: Value = serde_json::from_slice(&line)?;
                if let Some(error) = value["error"].as_str() {
                    anyhow::bail!("{error}");
                }
                if let (Some(c), Some(t)) = (value["completed"].as_u64(), value["total"].as_u64()) {
                    if t > 0 {
                        progress(c.saturating_mul(100) / t);
                    }
                }
            }
        }
        if !buffer.is_empty() {
            let value: Value = serde_json::from_slice(&buffer)?;
            if let Some(error) = value["error"].as_str() {
                anyhow::bail!("{error}");
            }
        }
        progress(100);
        Ok(())
    }
}
