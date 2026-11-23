use crate::{completion::is_assignment_completed, model::Item};
use anyhow::{Result, bail};
use chrono::{Duration, Utc};
use reqwest::{Client, cookie::CookieStore, header::HeaderValue};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

#[derive(Default)]
pub struct SessionJar(Mutex<cookie_store::CookieStore>);
impl SessionJar {
    pub fn add_cookie_str(&self, cookie: &str, url: &url::Url) {
        let _ = self.0.lock().unwrap().parse(cookie, url);
    }
    fn snapshot(&self) -> Result<Value> {
        let mut bytes = Vec::new();
        cookie_store::serde::json::save_incl_expired_and_nonpersistent(
            &self.0.lock().unwrap(),
            &mut bytes,
        )
        .map_err(|e| anyhow::anyhow!("Could not serialize the Canvas session: {e}"))?;
        Ok(serde_json::from_slice(&bytes)?)
    }
}
impl CookieStore for SessionJar {
    fn set_cookies(&self, headers: &mut dyn Iterator<Item = &HeaderValue>, url: &url::Url) {
        let mut store = self.0.lock().unwrap();
        for header in headers {
            if let Ok(text) = header.to_str() {
                let _ = store.parse(text, url);
            }
        }
    }
    fn cookies(&self, url: &url::Url) -> Option<HeaderValue> {
        let store = self.0.lock().unwrap();
        let text = store
            .get_request_values(url)
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        if text.is_empty() {
            None
        } else {
            HeaderValue::from_str(&text).ok()
        }
    }
}

#[derive(Clone)]
pub struct Canvas {
    pub client: Client,
    pub origin: String,
    pub jar: Arc<SessionJar>,
}

#[derive(Debug)]
pub struct Unauthorized;

impl std::fmt::Display for Unauthorized {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("unauthorized")
    }
}

impl std::error::Error for Unauthorized {}

pub struct SessionSync {
    pub items: Result<Vec<Item>>,
    pub session: Option<Value>,
    pub expired: bool,
}

fn login_redirect(from: &url::Url, to: &url::Url) -> bool {
    from.origin() == to.origin() && (to.path() == "/login" || to.path().starts_with("/login/"))
}

fn session_rejected(response: &reqwest::Response) -> bool {
    response.status() == reqwest::StatusCode::UNAUTHORIZED
        || (response.status().is_redirection()
            && response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|location| location.to_str().ok())
                .and_then(|location| response.url().join(location).ok())
                .is_some_and(|target| login_redirect(response.url(), &target)))
}
pub fn id(v: &Value) -> String {
    v.as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| v.to_string())
}
impl Canvas {
    pub fn new(origin: &str) -> Result<Self> {
        Self::with_user_agent(origin, None)
    }
    pub fn with_user_agent(origin: &str, agent: Option<&str>) -> Result<Self> {
        let u = url::Url::parse(origin)?;
        if !["http", "https"].contains(&u.scheme()) {
            bail!("invalid-url");
        }
        let jar = Arc::new(SessionJar::default());
        let mut builder = Client::builder()
            .cookie_provider(jar.clone())
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if login_redirect(&attempt.previous()[0], attempt.url()) {
                    attempt.stop()
                } else {
                    reqwest::redirect::Policy::default().redirect(attempt)
                }
            }))
            .timeout(std::time::Duration::from_secs(60));
        if let Some(agent) = agent {
            builder = builder.user_agent(agent);
        }
        let client = builder.build()?;
        Ok(Self {
            origin: u.origin().ascii_serialization(),
            client,
            jar,
        })
    }
    pub fn restore_session(session: &Value) -> Result<Self> {
        let origin = session["origin"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing Canvas session origin"))?;
        let canvas = Self::with_user_agent(origin, session["userAgent"].as_str())?;
        if let Some(snapshot) = session.get("cookieStore") {
            let bytes = serde_json::to_vec(snapshot)?;
            *canvas.jar.0.lock().unwrap() = cookie_store::serde::json::load(bytes.as_slice())
                .map_err(|e| anyhow::anyhow!("Could not restore the Canvas session: {e}"))?;
            return Ok(canvas);
        }
        let url = url::Url::parse(origin)?;
        for cookie in session["cookies"].as_array().into_iter().flatten() {
            let expiration = cookie["expirationDate"].as_f64();
            if expiration.is_some_and(|t| t <= Utc::now().timestamp() as f64) {
                continue;
            }
            let (Some(name), Some(value)) = (cookie["name"].as_str(), cookie["value"].as_str())
            else {
                continue;
            };
            let mut text = format!(
                "{name}={value}; Path={}",
                cookie["path"].as_str().unwrap_or("/")
            );
            if let Some(domain) = cookie["domain"].as_str() {
                text.push_str(&format!("; Domain={domain}"));
            }
            if cookie["secure"] == true {
                text.push_str("; Secure");
            }
            if cookie["httpOnly"] == true {
                text.push_str("; HttpOnly");
            }
            if let Some(expiration) =
                expiration.and_then(|t| chrono::DateTime::from_timestamp(t as i64, 0))
            {
                text.push_str(&format!(
                    "; Expires={}",
                    expiration.format("%a, %d %b %Y %H:%M:%S GMT")
                ));
            }
            canvas.jar.add_cookie_str(&text, &url);
        }
        Ok(canvas)
    }
    pub fn session_snapshot(&self, previous: &Value) -> Result<Value> {
        let mut session = previous.clone();
        session["cookieStore"] = self.jar.snapshot()?;
        // The browser export is only an input format. The jar now owns cookie expiry and rotation.
        session.as_object_mut().unwrap().remove("cookies");
        Ok(session)
    }
    pub async fn verify_profile(&self, agent: Option<&str>) -> Result<()> {
        let mut builder = Client::builder()
            .cookie_provider(self.jar.clone())
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(15));
        if let Some(agent) = agent {
            builder = builder.user_agent(agent);
        }
        let response = builder
            .build()?
            .get(format!("{}/api/v1/users/self/profile", self.origin))
            .header("Accept", "application/json")
            .header("Cache-Control", "no-store")
            .send()
            .await?;
        if session_rejected(&response) {
            return Err(Unauthorized.into());
        }
        if !response.status().is_success()
            || !response.headers().get(reqwest::header::CONTENT_TYPE)
                .and_then(|header| header.to_str().ok())
                .is_some_and(|header| header.contains("application/json"))
        {
            bail!("Canvas profile verification failed (HTTP {}).", response.status());
        }
        let profile: Value = response.json().await?;
        if profile["id"].as_u64().is_none()
            && !profile["id"].as_str().is_some_and(|id| !id.is_empty())
        {
            bail!("Canvas did not return a user profile.");
        }
        Ok(())
    }

    pub async fn sync_session(session: &Value, tracked: &[Item]) -> Result<SessionSync> {
        let candidate = Self::restore_session(session)?;
        let original = candidate.session_snapshot(session)?;
        let items = candidate.fetch(tracked).await;
        let updated = candidate.session_snapshot(session)?;
        let changed = updated != original;
        let rejected = items.as_ref().is_err_and(|error| error.is::<Unauthorized>());
        let (session, expired) = if items.is_ok() {
            (Some(updated).filter(|updated| updated != session), false)
        } else if changed || rejected {
            let agent = session["userAgent"].as_str();
            match candidate.verify_profile(agent).await {
                Ok(()) => (Some(candidate.session_snapshot(session)?).filter(|value| value != session), false),
                Err(error) if rejected && error.is::<Unauthorized>() => {
                    if changed {
                        // A rejected request may have cleared the cookie locally.
                        let previous = Self::restore_session(session)?;
                        match previous.verify_profile(agent).await {
                            Ok(()) => (Some(previous.session_snapshot(session)?).filter(|value| value != session), false),
                            Err(error) => (None, error.is::<Unauthorized>()),
                        }
                    } else {
                        (None, true)
                    }
                }
                Err(_) => (None, false),
            }
        } else {
            (None, false)
        };
        Ok(SessionSync { items, session, expired })
    }

    async fn optional_pages(&self, url: &str) -> Result<Vec<Value>> {
        match self.pages(url).await {
            Err(error) if !error.is::<Unauthorized>() => Ok(Vec::new()),
            result => result,
        }
    }
    pub async fn pages(&self, url: &str) -> Result<Vec<Value>> {
        let mut url = url::Url::parse(url)?;
        if !url.query_pairs().any(|(key, _)| key == "per_page") {
            url.query_pairs_mut().append_pair("per_page", "100");
        }
        let mut next = Some(url.to_string());
        let mut results = Vec::new();
        while let Some(url) = next.take() {
            let res = self
                .client
                .get(&url)
                .header("Accept", "application/json")
                .header("Cache-Control", "no-store")
                .send()
                .await?;
            if session_rejected(&res) {
                return Err(Unauthorized.into());
            }
            let res = res.error_for_status()?;
            next = res
                .headers()
                .get("link")
                .and_then(|v| v.to_str().ok())
                .and_then(|link| link.split(',').find(|s| s.contains("rel=\"next\"")))
                .and_then(|link| link.split('<').nth(1)?.split('>').next())
                .map(str::to_owned);
            let value: Value = res.json().await?;
            if let Value::Array(mut data) = value {
                results.append(&mut data);
            } else {
                results.push(value);
                break;
            }
        }
        Ok(results)
    }
    pub async fn tasks(&self, events: Vec<Value>, tracked: &[Item]) -> Result<Vec<Item>> {
        let mut all: Vec<Value> = events;
        for item in tracked {
            if item.is_manual
                || item.kind != "deadline"
                || item.assignment_id.is_none()
                || item.course_id.is_none()
                || item.school_url.as_deref() != Some(&self.origin)
                || all.iter().any(|e| id(&e["id"]) == item.id)
            {
                continue;
            }
            all.push(json!({"id":item.id,"type":"assignment","title":item.title,"start_at":item.due_date,"context_code":format!("course_{}",id(item.course_id.as_ref().unwrap())),"context_name":item.course,"assignment":{"id":item.assignment_id,"submission_types":item.submission_types},"cachedTask":item}));
        }
        let course_of = |e: &Value| -> Option<String> {
            if !e["assignment"]["course_id"].is_null() {
                Some(id(&e["assignment"]["course_id"]))
            } else {
                e["context_code"]
                    .as_str()?
                    .strip_prefix("course_")
                    .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
                    .map(str::to_owned)
            }
        };
        let mut courses: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for e in &all {
            if let Some(course) = course_of(e) {
                if !e["assignment"]["id"].is_null() {
                    let ids = courses.entry(course).or_default();
                    let aid = id(&e["assignment"]["id"]);
                    if !ids.contains(&aid) {
                        ids.push(aid);
                    }
                }
            }
        }
        let mut submissions: BTreeMap<String, Value> = BTreeMap::new();
        for (course, ids) in courses {
            for chunk in ids.chunks(20) {
                let mut u = url::Url::parse(&format!(
                    "{}/api/v1/courses/{course}/students/submissions",
                    self.origin
                ))?;
                for aid in chunk {
                    u.query_pairs_mut().append_pair("assignment_ids[]", aid);
                }
                match self.pages(u.as_str()).await {
                    Ok(rows) => {
                        for s in rows {
                            if !s["assignment_id"].is_null() {
                                submissions
                                    .insert(format!("{course}:{}", id(&s["assignment_id"])), s);
                            }
                        }
                    }
                    Err(e) if e.is::<Unauthorized>() => return Err(e),
                    Err(_) => {}
                }
            }
        }
        let zoom = regex::Regex::new(r"https://(?:[a-zA-Z0-9-]+\.)?zoom\.us/j/\d+")?;
        let mut tasks = Vec::new();
        for e in all {
            let course = course_of(&e);
            let a = &e["assignment"];
            let key = format!(
                "{}:{}",
                course.as_deref().unwrap_or("undefined"),
                id(&a["id"])
            );
            let mut s = submissions
                .get(&key)
                .cloned()
                .or_else(|| a.get("submission").filter(|s| !s.is_null()).cloned());
            if s.is_none() {
                if let (Some(course), Some(aid)) = (&course, a.get("id")) {
                    match self
                        .pages(&format!(
                            "{}/api/v1/courses/{course}/assignments/{}/submissions/self",
                            self.origin,
                            id(aid)
                        ))
                        .await
                    {
                        Ok(rows) => s = rows.into_iter().next(),
                        Err(err) if err.is::<Unauthorized>() => return Err(err),
                        Err(_) => {}
                    }
                }
            }
            let completed = s
                .as_ref()
                .map(|s| is_assignment_completed(a, Some(s)))
                .unwrap_or(
                    e["cachedTask"]["canvasCompleted"]
                        .as_bool()
                        .unwrap_or(false),
                );
            tasks.push(Item {
                id: id(&e["id"]),
                kind: if e["type"] == "assignment" {
                    "deadline"
                } else {
                    "event"
                }
                .into(),
                title: e["title"].as_str().unwrap_or("").into(),
                course: e["context_name"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or("Canvas Course")
                    .into(),
                due_date: e["start_at"].as_str().map(str::to_owned),
                completed,
                zoom_link: e["description"]
                    .as_str()
                    .and_then(|d| zoom.find(d))
                    .map(|m| m.as_str().into())
                    .or_else(|| e["cachedTask"]["zoomLink"].as_str().map(str::to_owned)),
                assignment_id: a.get("id").cloned(),
                course_id: course.map(Value::String),
                school_url: (!a.is_null()).then(|| self.origin.clone()),
                submission_types: a["submission_types"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect(),
                completion_known: (!a.is_null()).then_some(s.is_some()),
                ..Default::default()
            });
        }
        Ok(tasks)
    }
    pub async fn fetch(&self, tracked: &[Item]) -> Result<Vec<Item>> {
        let mut items = self
            .tasks(
                self.pages(&format!(
                    "{}/api/v1/users/self/upcoming_events",
                    self.origin
                ))
                .await?,
                tracked,
            )
            .await?;
        let mut course_map = BTreeMap::new();
        let courses = self
            .optional_pages(&format!(
                "{}/api/v1/courses?enrollment_state=active",
                self.origin
            ))
            .await?;
        for c in courses {
            if !c["id"].is_null() {
                course_map.insert(
                    format!("course_{}", id(&c["id"])),
                    c["course_code"]
                        .as_str()
                        .or(c["name"].as_str())
                        .unwrap_or("Canvas Course")
                        .to_owned(),
                );
            }
        }
        let start = Utc::now() - Duration::days(14);
        if !course_map.is_empty() {
            let mut u = url::Url::parse(&format!("{}/api/v1/announcements", self.origin))?;
            for course in course_map.keys() {
                u.query_pairs_mut().append_pair("context_codes[]", course);
            }
            u.query_pairs_mut()
                .append_pair("start_date", &start.to_rfc3339());
            for a in self.optional_pages(u.as_str()).await? {
                let date = a["posted_at"].as_str().or(a["created_at"].as_str());
                if !date
                    .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
                    .is_some_and(|d| d >= start)
                {
                    continue;
                }
                items.push(Item {
                    id: id(&a["id"]),
                    kind: "announcement".into(),
                    title: decode(a["title"].as_str().unwrap_or("Announcement")),
                    course: course_map
                        .get(a["context_code"].as_str().unwrap_or(""))
                        .cloned()
                        .unwrap_or("Canvas Course".into()),
                    date: date.map(str::to_owned),
                    preview: Some(strip_html(a["message"].as_str().unwrap_or(""))),
                    author: Some(
                        a["user_name"]
                            .as_str()
                            .or(a["author"]["display_name"].as_str())
                            .unwrap_or("Unknown")
                            .into(),
                    ),
                    ..Default::default()
                });
            }
        }
        for e in self
            .optional_pages(&format!(
                "{}/api/v1/users/self/activity_stream",
                self.origin
            ))
            .await?
        {
            if e["type"] != "Submission" {
                continue;
            }
            let context = e["context_code"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("course_{}", id(&e["course_id"])));
            for c in e["submission_comments"].as_array().into_iter().flatten() {
                items.push(Item {
                    id: id(&c["id"]),
                    kind: "comment".into(),
                    title: e["title"]
                        .as_str()
                        .map(|t| format!("Feedback on {t}"))
                        .unwrap_or("Feedback on Submission".into()),
                    course: course_map
                        .get(&context)
                        .cloned()
                        .unwrap_or("Canvas Course".into()),
                    date: c["created_at"].as_str().map(str::to_owned),
                    preview: Some(c["comment"].as_str().unwrap_or("").into()),
                    author: Some(c["author_name"].as_str().unwrap_or("Unknown").into()),
                    ..Default::default()
                });
            }
        }
        Ok(items)
    }
}
pub fn decode(s: &str) -> String {
    let mut s = s.to_owned();
    for (a, b) in [
        ("&amp;", "&"),
        ("&nbsp;", " "),
        ("&quot;", "\""),
        ("&ldquo;", "\""),
        ("&rdquo;", "\""),
        ("&lsquo;", "'"),
        ("&rsquo;", "'"),
        ("&ndash;", "-"),
        ("&mdash;", "-"),
        ("&lt;", "<"),
        ("&gt;", ">"),
    ] {
        s = s.replace(a, b);
    }
    s
}
fn strip_html(s: &str) -> String {
    let block = regex::Regex::new(r"(?i)</?(?:p|div|br|h[1-6]|li|ol|ul)\b[^>]*>").unwrap();
    let tag = regex::Regex::new(r"<[^>]*>").unwrap();
    decode(tag.replace_all(&block.replace_all(s, " "), "").trim())
}
