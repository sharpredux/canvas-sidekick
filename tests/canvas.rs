use canvas_sidekick_rust::{canvas::Canvas, model::Item};
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{Arc, Mutex},
};
fn server(
    reply: impl Fn(&str) -> (u16, serde_json::Value, Option<String>) + Send + 'static,
) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let calls = Arc::new(Mutex::new(Vec::new()));
    let log = calls.clone();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let mut request = vec![0; 16384];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]);
            let path = request.split_whitespace().nth(1).unwrap().to_owned();
            log.lock().unwrap().push(path.clone());
            let (status, body, link) = reply(&path);
            let body = body.to_string();
            let link = link.map(|s| format!("Link: {s}\r\n")).unwrap_or_default();
            write!(stream,"HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{link}\r\n{body}",body.len()).unwrap();
        }
    });
    (origin, calls)
}
fn event(id: u32) -> serde_json::Value {
    json!({"id":format!("assignment_{id}"),"type":"assignment","title":"Task","context_code":"course_101","start_at":"2026-11-10T00:00:00Z","assignment":{"id":id,"submission_types":["online_upload"]}})
}
#[tokio::test]
async fn batches_current_user_submissions_in_groups_of_twenty() {
    let (origin, calls) = server(|path| {
        assert!(!path.contains("student_ids"));
        let url = url::Url::parse(&format!("http://local{path}")).unwrap();
        let ids: Vec<_> = url
            .query_pairs()
            .filter(|(key, _)| key == "assignment_ids[]")
            .map(|(_, v)| v.to_string())
            .collect();
        assert!(ids.len() <= 20);
        (
            200,
            json!(
                ids.iter()
                    .map(|id| json!({"assignment_id":id,"workflow_state":"submitted"}))
                    .collect::<Vec<_>>()
            ),
            None,
        )
    });
    let canvas = Canvas::new(&origin).unwrap();
    let tasks = canvas
        .tasks((1..=22).map(event).collect(), &[])
        .await
        .unwrap();
    assert_eq!(tasks.len(), 22);
    assert!(tasks.iter().all(|t| t.completed));
    assert_eq!(calls.lock().unwrap().len(), 2);
}
#[tokio::test]
async fn missing_batch_rows_fall_back_to_self() {
    let (origin, calls) = server(|p| {
        if p.contains("students/") {
            (200, json!([]), None)
        } else {
            assert!(p.contains("submissions/self"));
            (200, json!({"workflow_state":"submitted"}), None)
        }
    });
    let tasks = Canvas::new(&origin)
        .unwrap()
        .tasks(vec![event(1)], &[])
        .await
        .unwrap();
    assert!(tasks[0].completed);
    assert_eq!(calls.lock().unwrap().len(), 2);
}
#[tokio::test]
async fn unauthorized_is_not_treated_as_empty_success() {
    let (origin, _) = server(|_| (401, json!({}), None));
    let err = Canvas::new(&origin)
        .unwrap()
        .tasks(vec![event(1)], &[])
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), "unauthorized");
}
#[tokio::test]
async fn disappearing_assignments_remain_tracked() {
    let (origin, _) = server(|_| {
        (
            200,
            json!([{"assignment_id":1,"workflow_state":"submitted"}]),
            None,
        )
    });
    let canvas = Canvas::new(&origin).unwrap();
    let cached = Item {
        id: "assignment_1".into(),
        kind: "deadline".into(),
        assignment_id: Some(json!(1)),
        course_id: Some(json!(101)),
        school_url: Some(origin.clone()),
        ..Default::default()
    };
    let tasks = canvas.tasks(vec![], &[cached.clone()]).await.unwrap();
    assert!(tasks[0].completed);
    assert_eq!(tasks[0].id, cached.id);
    let other = Item {
        school_url: Some("https://other.example".into()),
        ..cached
    };
    assert!(canvas.tasks(vec![], &[other]).await.unwrap().is_empty());
}
#[tokio::test]
async fn batch_failure_preserves_embedded_submission() {
    let (origin, _) = server(|_| (403, json!({}), None));
    let mut e = event(1);
    e["assignment"]["submission"] = json!({"submitted_at":"2026-10-01"});
    let tasks = Canvas::new(&origin)
        .unwrap()
        .tasks(vec![e], &[])
        .await
        .unwrap();
    assert!(tasks[0].completed);
}
#[tokio::test]
async fn follows_link_headers_and_checks_nonarray_results() {
    let base = Arc::new(Mutex::new(String::new()));
    let b = base.clone();
    let (origin, calls) = server(move |p| {
        if p.starts_with("/first") {
            (
                200,
                json!([1, 2]),
                Some(format!("<{}/second>; rel=\"next\"", b.lock().unwrap())),
            )
        } else {
            (200, json!({"id":3}), None)
        }
    });
    *base.lock().unwrap() = origin.clone();
    let rows = Canvas::new(&origin)
        .unwrap()
        .pages(&format!("{origin}/first"))
        .await
        .unwrap();
    assert_eq!(rows, json!([1,2,{"id":3}]).as_array().unwrap().clone());
    assert_eq!(calls.lock().unwrap().len(), 2);
}
