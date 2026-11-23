/// Place a browser-style popup using the monitor containing its owner anchor.
#[cfg(target_os = "linux")]
pub fn popup_position(anchor: [f32; 4], size: [f32; 2], scale: f32) -> anyhow::Result<[f32; 2]> {
    use x11rb::{
        connection::Connection,
        protocol::{randr::ConnectionExt as _, xproto::*},
    };
    let (conn, screen) = x11rb::connect(None)?;
    let screen = &conn.setup().roots[screen];
    let point = [
        (anchor[0] + anchor[2]) * 0.5 * scale,
        (anchor[1] + anchor[3]) * 0.5 * scale,
    ];
    let monitors = conn
        .randr_get_monitors(screen.root, true)?
        .reply()?
        .monitors;
    let monitor = monitors.iter().find(|m| {
        point[0] >= m.x as f32
            && point[0] < (m.x as f32 + m.width as f32)
            && point[1] >= m.y as f32
            && point[1] < (m.y as f32 + m.height as f32)
    });
    let mut work = monitor
        .map(|m| [m.x as f32, m.y as f32, m.width as f32, m.height as f32])
        .unwrap_or([
            0.,
            0.,
            screen.width_in_pixels as f32,
            screen.height_in_pixels as f32,
        ]);
    let atom = conn.intern_atom(false, b"_NET_WORKAREA")?.reply()?.atom;
    let property = conn
        .get_property(false, screen.root, atom, AtomEnum::CARDINAL, 0, 4)?
        .reply()?;
    if let Some(mut values) = property.value32() {
        if let (Some(x), Some(y), Some(w), Some(h)) =
            (values.next(), values.next(), values.next(), values.next())
        {
            let left = work[0].max(x as i32 as f32);
            let top = work[1].max(y as i32 as f32);
            let right = (work[0] + work[2]).min(x as i32 as f32 + w as f32);
            let bottom = (work[1] + work[3]).min(y as i32 as f32 + h as f32);
            if right > left && bottom > top {
                work = [left, top, right - left, bottom - top];
            }
        }
    }
    let work = work.map(|value| value / scale);
    Ok(crate::window_geometry::popup_position(anchor, size, work))
}

/// Fit desktop pixels to the monitor work area, preserving the legacy top-right first launch.
#[cfg(target_os = "linux")]
pub fn fit(xid: u32, size: [f32; 2], scale: f32, initial: bool) -> anyhow::Result<[f32; 4]> {
    use x11rb::{
        connection::Connection,
        protocol::{randr::ConnectionExt as _, xproto::*},
    };
    let (conn, screen) = x11rb::connect(None)?;
    let screen = &conn.setup().roots[screen];
    let geo = conn.get_geometry(xid)?.reply()?;
    let point = conn
        .translate_coordinates(xid, screen.root, 0, 0)?
        .reply()?;
    let monitors = conn
        .randr_get_monitors(screen.root, true)?
        .reply()?
        .monitors;
    let area = |m: &x11rb::protocol::randr::MonitorInfo| {
        [m.x as f32, m.y as f32, m.width as f32, m.height as f32]
    };
    let mut work = if initial {
        monitors
            .iter()
            .find(|m| m.primary)
            .or(monitors.first())
            .map(area)
    } else {
        monitors
            .iter()
            .max_by_key(|m| {
                let width = (i32::from(m.x) + i32::from(m.width))
                    .min(i32::from(point.dst_x) + i32::from(geo.width))
                    - i32::from(m.x).max(i32::from(point.dst_x));
                let height = (i32::from(m.y) + i32::from(m.height))
                    .min(i32::from(point.dst_y) + i32::from(geo.height))
                    - i32::from(m.y).max(i32::from(point.dst_y));
                width.max(0) * height.max(0)
            })
            .map(area)
    }
    .unwrap_or([
        0.,
        0.,
        screen.width_in_pixels as f32,
        screen.height_in_pixels as f32,
    ]);
    let atom = conn.intern_atom(false, b"_NET_WORKAREA")?.reply()?.atom;
    let property = conn
        .get_property(false, screen.root, atom, AtomEnum::CARDINAL, 0, 4)?
        .reply()?;
    if let Some(mut values) = property.value32() {
        if let (Some(x), Some(y), Some(w), Some(h)) =
            (values.next(), values.next(), values.next(), values.next())
        {
            let left = work[0].max(x as i32 as f32);
            let top = work[1].max(y as i32 as f32);
            let right = (work[0] + work[2]).min(x as i32 as f32 + w as f32);
            let bottom = (work[1] + work[3]).min(y as i32 as f32 + h as f32);
            if right > left && bottom > top {
                work = [left, top, right - left, bottom - top];
            }
        }
    }
    let width = (size[0] * scale).min(work[2]);
    let height = (size[1] * scale).min(work[3]);
    let x = if initial {
        work[0] + work[2] - width - 24. * scale
    } else {
        point.dst_x as f32
    };
    let y = if initial {
        work[1] + 24. * scale
    } else {
        point.dst_y as f32
    };
    Ok([
        x.clamp(work[0], work[0] + work[2] - width),
        y.clamp(work[1], work[1] + work[3] - height),
        width,
        height,
    ])
}

#[cfg(target_os = "linux")]
pub fn hide_from_taskbar(xid: u32, before_map: bool) -> anyhow::Result<bool> {
    use x11rb::{protocol::xproto::*, wrapper::ConnectionExt as _};

    let (conn, _) = x11rb::connect(None)?;
    let atom = |name: &[u8]| -> anyhow::Result<u32> {
        Ok(conn.intern_atom(false, name)?.reply()?.atom)
    };
    let state = atom(b"_NET_WM_STATE")?;
    let hints = [
        atom(b"_NET_WM_STATE_SKIP_TASKBAR")?,
        atom(b"_NET_WM_STATE_SKIP_PAGER")?,
    ];
    let property = conn.get_property(false, xid, state, AtomEnum::ATOM, 0, u32::MAX)?.reply()?;
    let mut present: Vec<_> = property.value32().into_iter().flatten().collect();
    let missing: Vec<_> = hints.into_iter().filter(|atom| !present.contains(atom)).collect();
    if before_map {
        present.extend(missing);
        conn.change_property32(PropMode::REPLACE, xid, state, AtomEnum::ATOM, &present)?.check()?;
    } else {
        if conn.get_window_attributes(xid)?.reply()?.map_state != MapState::VIEWABLE {
            return Ok(false);
        }
        if let Some(&first) = missing.first() {
            let root = conn.get_geometry(xid)?.reply()?.root;
            let event = ClientMessageEvent::new(
                32,
                xid,
                state,
                ClientMessageData::from([1, first, missing.get(1).copied().unwrap_or(0), 1, 0]),
            );
            conn.send_event(
                false,
                root,
                EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
                event,
            )?.check()?;
        }
    }
    Ok(true)
}

#[cfg(target_os = "linux")]
pub fn shape(xid: u32, scale: f32, parent: Option<u32>, attach: bool) -> anyhow::Result<()> {
    use x11rb::{
        connection::Connection,
        protocol::{
            shape::{self, ConnectionExt as _},
            xproto::*,
        },
    };
    let (conn, screen) = x11rb::connect(None)?;
    let root = conn.setup().roots[screen].root;
    let atom = |name: &str| -> anyhow::Result<u32> {
        Ok(conn.intern_atom(false, name.as_bytes())?.reply()?.atom)
    };
    if let Some(parent) = parent {
        if attach {
            conn.reparent_window(xid, parent, 0, 0)?.check()?;
        }
    } else if attach {
        let event = ClientMessageEvent::new(
            32,
            xid,
            atom("_NET_WM_STATE")?,
            ClientMessageData::from([
                1, atom("_NET_WM_STATE_BELOW")?, atom("_NET_WM_STATE_STICKY")?, 1, 0,
            ]),
        );
        conn.send_event(
            false,
            root,
            EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY,
            event,
        )?
        .check()?;
    }
    let geometry = conn.get_geometry(xid)?.reply()?;
    let width = geometry.width;
    let height = geometry.height;
    let r = (24. * scale).round().min(width.min(height) as f32 / 2.) as i16;
    let mut rectangles = Vec::new();
    for y in 0..r {
        let d = r as f32 - y as f32 - 0.5;
        let exponent = if parent.is_some() { 4_f32 } else { 2. };
        let inset = (r as f32
            * (1.
                - (1. - (d / r as f32).powf(exponent))
                    .max(0.)
                    .powf(1. / exponent)))
        .round() as i16;
        let row = Rectangle {
            x: inset,
            y,
            width: width - 2 * inset as u16,
            height: 1,
        };
        rectangles.push(row);
        rectangles.push(Rectangle {
            y: height as i16 - y - 1,
            ..row
        });
    }
    if height > 2 * r as u16 {
        rectangles.push(Rectangle {
            x: 0,
            y: r,
            width,
            height: height - 2 * r as u16,
        });
    }
    let composited = conn
        .get_selection_owner(atom(&format!("_NET_WM_CM_S{screen}"))?)?
        .reply()?
        .owner
        != 0;
    if composited {
        conn.shape_mask(shape::SO::SET, shape::SK::BOUNDING, xid, 0, 0, x11rb::NONE)?
            .check()?;
    } else {
        conn.shape_rectangles(
            shape::SO::SET,
            shape::SK::BOUNDING,
            ClipOrdering::UNSORTED,
            xid,
            0,
            0,
            &rectangles,
        )?
        .check()?;
    }
    conn.shape_rectangles(
        shape::SO::SET,
        shape::SK::INPUT,
        ClipOrdering::UNSORTED,
        xid,
        0,
        0,
        &rectangles,
    )?
    .check()?;
    conn.flush()?;
    Ok(())
}
