#![cfg(any(target_os = "linux", target_os = "windows"))]
use canvas_sidekick_rust::credentials::Credentials;
#[test]
#[ignore = "Requires an unlocked native credential store; uses a unique temporary profile identity"]
fn native_session_round_trip_never_writes_plaintext_profile_file() {
    let temporary = tempfile::tempdir().unwrap();
    let store = Credentials::new(temporary.path());
    assert!(store.load().unwrap().is_none());
    let session = serde_json::json!({"origin":"https://canvas.synthetic.example","cookies":[{"name":"canvas_session","value":"synthetic-secret"}]});
    store.save(&session).unwrap();
    let restored = store.load().unwrap();
    store.clear().unwrap();
    assert_eq!(restored, Some(session));
    assert!(store.load().unwrap().is_none());
    for path in std::fs::read_dir(temporary.path()).unwrap() {
        let bytes = std::fs::read(path.unwrap().path()).unwrap();
        assert!(
            !bytes
                .windows(b"synthetic-secret".len())
                .any(|w| w == b"synthetic-secret")
        );
    }
}
