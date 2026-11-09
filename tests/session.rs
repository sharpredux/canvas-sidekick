use canvas_sidekick_rust::canvas::Canvas;
use reqwest::{cookie::CookieStore, header::HeaderValue};
use serde_json::json;

#[test]
fn rotated_and_expired_cookies_survive_protected_session_roundtrip() {
    let session = json!({"origin":"https://canvas.example","userAgent":"Native browser fixture","cookies":[
        {"name":"canvas_session","value":"original","domain":"canvas.example","path":"/","httpOnly":true,"secure":true},
        {"name":"removed","value":"old","domain":"canvas.example","path":"/"}
    ]});
    let canvas = Canvas::restore_session(&session).unwrap();
    let url = url::Url::parse("https://canvas.example/api/v1/users/self/profile").unwrap();
    canvas.jar.set_cookies(
        &mut [
            HeaderValue::from_static("canvas_session=rotated; Path=/; HttpOnly; Secure"),
            HeaderValue::from_static("removed=; Path=/; Max-Age=0"),
        ]
        .iter(),
        &url,
    );
    let snapshot = canvas.session_snapshot(&session).unwrap();
    assert!(snapshot.get("cookies").is_none());
    let restored = Canvas::restore_session(&snapshot).unwrap();
    let header = restored.jar.cookies(&url).unwrap();
    assert_eq!(header.to_str().unwrap(), "canvas_session=rotated");
    assert_eq!(snapshot["userAgent"], session["userAgent"]);
}
#[test]
fn expired_browser_exports_are_not_revived() {
    let canvas = Canvas::restore_session(&json!({"origin":"https://canvas.example","cookies":[
        {"name":"expired","value":"old","domain":"canvas.example","path":"/","expirationDate":1},
        {"name":"session","value":"active","domain":"canvas.example","path":"/"}
    ]}))
    .unwrap();
    let url = url::Url::parse("https://canvas.example").unwrap();
    assert_eq!(
        canvas.jar.cookies(&url).unwrap().to_str().unwrap(),
        "session=active"
    );
}
