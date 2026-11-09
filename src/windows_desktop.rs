//! Win32 desktop parenting and power/session recovery, translated from the Electron host.
//! Runtime validation remains pending on a Windows machine.
use std::{ffi::c_void, ptr};
type Hwnd = *mut c_void;
#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
#[repr(C)]
struct MonitorInfo {
    size: u32,
    monitor: Rect,
    work: Rect,
    flags: u32,
}
const SUBCLASS_ID: usize = 0x43534b;
#[link(name = "user32")]
unsafe extern "system" {
    fn FindWindowW(class: *const u16, title: *const u16) -> Hwnd;
    fn FindWindowExW(parent: Hwnd, after: Hwnd, class: *const u16, title: *const u16) -> Hwnd;
    fn SendMessageTimeoutW(
        hwnd: Hwnd,
        message: u32,
        wparam: usize,
        lparam: isize,
        flags: u32,
        timeout: u32,
        result: *mut usize,
    ) -> isize;
    fn EnumWindows(
        callback: Option<unsafe extern "system" fn(Hwnd, isize) -> i32>,
        data: isize,
    ) -> i32;
    fn SetParent(child: Hwnd, parent: Hwnd) -> Hwnd;
    fn MonitorFromRect(rect: *const Rect, flags: u32) -> *mut c_void;
    fn GetMonitorInfoW(monitor: *mut c_void, info: *mut MonitorInfo) -> i32;
    fn GetWindowLongPtrW(hwnd: Hwnd, index: i32) -> isize;
    fn SetWindowLongPtrW(hwnd: Hwnd, index: i32, value: isize) -> isize;
    fn SetWindowPos(
        hwnd: Hwnd,
        after: Hwnd,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        flags: u32,
    ) -> i32;
    fn ShowWindow(hwnd: Hwnd, command: i32) -> i32;
    fn SetTimer(hwnd: Hwnd, id: usize, elapsed: u32, callback: *const c_void) -> usize;
    fn KillTimer(hwnd: Hwnd, id: usize) -> i32;
    fn RegisterSuspendResumeNotification(recipient: Hwnd, flags: u32) -> *mut c_void;
    fn UnregisterSuspendResumeNotification(handle: *mut c_void) -> i32;
}
#[link(name = "comctl32")]
unsafe extern "system" {
    fn SetWindowSubclass(
        hwnd: Hwnd,
        callback: Option<unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize>,
        id: usize,
        data: usize,
    ) -> i32;
    fn RemoveWindowSubclass(
        hwnd: Hwnd,
        callback: Option<unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize>,
        id: usize,
    ) -> i32;
    fn DefSubclassProc(hwnd: Hwnd, message: u32, wparam: usize, lparam: isize) -> isize;
}
#[link(name = "wtsapi32")]
unsafe extern "system" {
    fn WTSRegisterSessionNotification(hwnd: Hwnd, flags: u32) -> i32;
    fn WTSUnRegisterSessionNotification(hwnd: Hwnd) -> i32;
}
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
pub fn popup_position(anchor: [f32; 4], size: [f32; 2], scale: f32) -> Option<[f32; 2]> {
    let rectangle = Rect {
        left: (anchor[0] * scale) as i32,
        top: (anchor[1] * scale) as i32,
        right: (anchor[2] * scale) as i32,
        bottom: (anchor[3] * scale) as i32,
    };
    let monitor = unsafe { MonitorFromRect(&rectangle, 2) };
    if monitor.is_null() {
        return None;
    }
    let mut info = MonitorInfo {
        size: std::mem::size_of::<MonitorInfo>() as u32,
        monitor: Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        work: Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
        flags: 0,
    };
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return None;
    }
    let work = [
        info.work.left as f32 / scale,
        info.work.top as f32 / scale,
        (info.work.right - info.work.left) as f32 / scale,
        (info.work.bottom - info.work.top) as f32 / scale,
    ];
    Some(crate::window_geometry::popup_position(anchor, size, work))
}
unsafe extern "system" fn find_worker(hwnd: Hwnd, data: isize) -> i32 {
    let shell = unsafe {
        FindWindowExW(
            hwnd,
            ptr::null_mut(),
            wide("SHELLDLL_DefView").as_ptr(),
            ptr::null(),
        )
    };
    if !shell.is_null() {
        let worker =
            unsafe { FindWindowExW(ptr::null_mut(), hwnd, wide("WorkerW").as_ptr(), ptr::null()) };
        unsafe { *(data as *mut Hwnd) = worker };
        return 0;
    }
    1
}
unsafe fn embed(hwnd: Hwnd) {
    let progman = unsafe { FindWindowW(wide("Progman").as_ptr(), ptr::null()) };
    if progman.is_null() {
        return;
    }
    let mut result = 0;
    unsafe { SendMessageTimeoutW(progman, 0x052c, 0, 0, 2, 1000, &mut result) };
    let mut worker: Hwnd = ptr::null_mut();
    unsafe { EnumWindows(Some(find_worker), (&mut worker as *mut Hwnd) as isize) };
    if !worker.is_null() {
        unsafe { SetParent(hwnd, worker) };
    }
}
struct Hook {
    power: *mut c_void,
}
unsafe extern "system" fn window_proc(
    hwnd: Hwnd,
    message: u32,
    wparam: usize,
    lparam: isize,
    _id: usize,
    data: usize,
) -> isize {
    match message {
        0x0005 if wparam == 1 => {
            unsafe { ShowWindow(hwnd, 9) };
        } // Keep the widget visible after Show Desktop.
        0x0218 if wparam == 4 => {
            unsafe {
                KillTimer(hwnd, SUBCLASS_ID);
                SetParent(hwnd, ptr::null_mut())
            };
        }
        0x0218 if wparam == 7 || wparam == 18 => {
            unsafe {
                KillTimer(hwnd, SUBCLASS_ID);
                SetTimer(hwnd, SUBCLASS_ID, 1500, ptr::null())
            };
        }
        0x02b1 if wparam == 7 => {
            unsafe {
                KillTimer(hwnd, SUBCLASS_ID);
                SetParent(hwnd, ptr::null_mut())
            };
        }
        0x02b1 if wparam == 8 => {
            unsafe {
                KillTimer(hwnd, SUBCLASS_ID);
                SetTimer(hwnd, SUBCLASS_ID, 1500, ptr::null())
            };
        }
        0x0113 if wparam == SUBCLASS_ID => {
            unsafe {
                KillTimer(hwnd, SUBCLASS_ID);
                embed(hwnd)
            };
        }
        0x0082 => {
            unsafe {
                RemoveWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID);
                WTSUnRegisterSessionNotification(hwnd)
            };
            let hook = unsafe { Box::from_raw(data as *mut Hook) };
            if !hook.power.is_null() {
                unsafe { UnregisterSuspendResumeNotification(hook.power) };
            }
        }
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}
pub fn attach(hwnd: usize, parent: Option<usize>) {
    let hwnd = hwnd as Hwnd;
    if let Some(parent) = parent {
        unsafe {
            // SetParent does not convert a top-level window into a child window.
            let style = GetWindowLongPtrW(hwnd, -16);
            SetWindowLongPtrW(hwnd, -16, (style & !(0x80000000_u32 as isize)) | 0x40000000);
            SetParent(hwnd, parent as Hwnd);
            SetWindowPos(
                hwnd,
                ptr::null_mut(),
                0,
                0,
                0,
                0,
                0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020,
            );
        }
        return;
    }
    unsafe { embed(hwnd) };
    let power = unsafe { RegisterSuspendResumeNotification(hwnd, 0) };
    let hook = Box::into_raw(Box::new(Hook { power }));
    if unsafe { SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS_ID, hook as usize) } == 0 {
        let hook = unsafe { Box::from_raw(hook) };
        if !hook.power.is_null() {
            unsafe { UnregisterSuspendResumeNotification(hook.power) };
        }
    } else {
        unsafe { WTSRegisterSessionNotification(hwnd, 0) };
    }
}
