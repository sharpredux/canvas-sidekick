#![cfg(all(feature = "desktop", target_os = "linux"))]
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use x11rb::{
    connection::Connection,
    protocol::{
        shape::{self, ConnectionExt as _},
        xproto::ConnectionExt,
    },
};
struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn launch(parent: Option<u32>) -> (Process, u32) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_native-window-gate"));
    cmd.env_remove("WAYLAND_DISPLAY")
        .args(["--seconds", "20"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(parent) = parent {
        cmd.args(["--parent", &parent.to_string()]);
    }
    let mut child = Process(cmd.spawn().unwrap());
    let stdout = child.0.stdout.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                let _ = tx.send(v);
            }
        }
    });
    let ready = rx
        .recv_timeout(Duration::from_secs(10))
        .expect("native window must become ready");
    let xid = ready["xid"].as_u64().expect("must use X11") as u32;
    (child, xid)
}
fn wait_until(mut check: impl FnMut() -> bool) {
    let until = Instant::now() + Duration::from_secs(3);
    loop {
        if check() {
            return;
        }
        assert!(Instant::now() < until, "native state did not settle");
        std::thread::sleep(Duration::from_millis(50));
    }
}
#[test]
#[ignore = "Requires a real X11 graphical session"]
fn rounded_input_region_and_resize() {
    let (mut process, xid) = launch(None);
    let (conn, _) = x11rb::connect(None).unwrap();
    for (w, h) in [(360, 520), (280, 320), (480, 640)] {
        writeln!(
            process.0.stdin.as_mut().unwrap(),
            "{}",
            serde_json::json!({"type":"bounds","width":w,"height":h})
        )
        .unwrap();
        wait_until(|| {
            conn.get_geometry(xid)
                .unwrap()
                .reply()
                .is_ok_and(|g| g.width == w && g.height == h)
        });
        wait_until(|| {
            conn.shape_get_rectangles(xid, shape::SK::INPUT)
                .unwrap()
                .reply()
                .is_ok_and(|r| {
                    r.rectangles.len() > 1 && r.rectangles.iter().all(|r| r.x > 0 || r.y > 0)
                })
        });
        let rectangles = conn
            .shape_get_rectangles(xid, shape::SK::INPUT)
            .unwrap()
            .reply()
            .unwrap()
            .rectangles;
        assert!(rectangles.iter().any(|r| r.x <= w as i16 / 2
            && r.y <= h as i16 / 2
            && r.x + r.width as i16 > w as i16 / 2
            && r.y + r.height as i16 > h as i16 / 2));
    }
}
#[test]
#[ignore = "Requires a real X11 graphical session"]
fn native_child_attaches_to_host_and_resizes() {
    use x11rb::protocol::xproto::*;
    let (conn, screen) = x11rb::connect(None).unwrap();
    let parent = conn.generate_id().unwrap();
    let root = &conn.setup().roots[screen];
    conn.create_window(
        root.root_depth,
        parent,
        root.root,
        80,
        80,
        800,
        700,
        0,
        WindowClass::INPUT_OUTPUT,
        root.root_visual,
        &CreateWindowAux::new().background_pixel(0x224455),
    )
    .unwrap()
    .check()
    .unwrap();
    conn.map_window(parent).unwrap().check().unwrap();
    conn.flush().unwrap();
    let (mut process, xid) = launch(Some(parent));
    wait_until(|| {
        conn.query_tree(xid)
            .unwrap()
            .reply()
            .is_ok_and(|r| r.parent == parent)
    });
    writeln!(
        process.0.stdin.as_mut().unwrap(),
        "{}",
        serde_json::json!({"type":"bounds","width":600,"height":500,"x":20,"y":30})
    )
    .unwrap();
    wait_until(|| {
        conn.get_geometry(xid)
            .unwrap()
            .reply()
            .is_ok_and(|g| g.width == 600 && g.height == 500)
    });
    drop(process);
    conn.destroy_window(parent).unwrap().check().unwrap();
}
