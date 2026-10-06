import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const AUTOSTART_FILE = 'canvas-sidekick.desktop';
let x11ApiPromise = null;

async function loadX11Api() {
  if (!x11ApiPromise) {
    x11ApiPromise = import('koffi').then(({ default: koffi }) => {
      const x11 = koffi.load('libX11.so.6');
      const XClientMessageData = koffi.union({
        b: koffi.array('char', 20),
        s: koffi.array('short', 10),
        l: koffi.array('long', 5)
      });
      const XClientMessageEvent = koffi.struct({
        type: 'int',
        serial: 'unsigned long',
        send_event: 'int',
        display: 'void *',
        window: 'unsigned long',
        message_type: 'unsigned long',
        format: 'int',
        data: XClientMessageData
      });
      const XEvent = koffi.union('CanvasSidekickXEvent', {
        xclient: XClientMessageEvent,
        pad: koffi.array('long', 24)
      });

      return {
        XOpenDisplay: x11.func('void *XOpenDisplay(str display_name)'),
        XDefaultRootWindow: x11.func('unsigned long XDefaultRootWindow(void *display)'),
        XInternAtom: x11.func('unsigned long XInternAtom(void *display, str atom_name, int only_if_exists)'),
        XSendEvent: x11.func('int XSendEvent(void *display, unsigned long window, int propagate, long event_mask, CanvasSidekickXEvent *event_send)'),
        XFlush: x11.func('int XFlush(void *display)'),
        XCloseDisplay: x11.func('int XCloseDisplay(void *display)'),
        XEvent
      };
    });
  }
  return x11ApiPromise;
}

function sendWindowState(api, display, root, xid, firstState, secondState) {
  const event = {
    xclient: {
      type: 33, // ClientMessage
      serial: 0,
      send_event: 1,
      display,
      window: xid,
      message_type: api.XInternAtom(display, '_NET_WM_STATE', 0),
      format: 32,
      data: {
        l: [
          1, // _NET_WM_STATE_ADD
          api.XInternAtom(display, firstState, 0),
          secondState ? api.XInternAtom(display, secondState, 0) : 0,
          1, // normal application
          0
        ]
      }
    }
  };

  const eventMask = (1 << 20) | (1 << 19); // SubstructureRedirectMask | SubstructureNotifyMask
  return api.XSendEvent(display, root, 0, eventMask, event);
}

function quoteDesktopExec(value) {
  return `"${String(value).replace(/([\\"`$])/g, '\\$1')}"`;
}

function getAutostartPath() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config');
  return path.join(configHome, 'autostart', AUTOSTART_FILE);
}

function getLaunchCommand() {
  if (app.isPackaged) {
    // AppImage executables live in a temporary mount that changes each launch.
    return [process.env.APPIMAGE || process.execPath];
  }
  return [process.execPath, app.getAppPath()];
}

export function getLinuxStartupStatus() {
  if (process.platform !== 'linux') return false;
  return fs.existsSync(getAutostartPath());
}

export function setLinuxStartupStatus(enabled) {
  if (process.platform !== 'linux') return;

  const autostartPath = getAutostartPath();
  if (!enabled) {
    try {
      fs.unlinkSync(autostartPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return;
  }

  fs.mkdirSync(path.dirname(autostartPath), { recursive: true });
  const exec = getLaunchCommand().map(quoteDesktopExec).join(' ');
  const desktopEntry = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=Canvas Sidekick',
    'Comment=Canvas agenda and study assistant',
    `Exec=${exec}`,
    'Terminal=false',
    'StartupNotify=false',
    'X-GNOME-Autostart-enabled=true',
    'X-KDE-autostart-after=panel',
    ''
  ].join('\n');

  fs.writeFileSync(autostartPath, desktopEntry, { encoding: 'utf8', mode: 0o644 });
}

export async function applyLinuxDesktopHints(windowInstance) {
  if (process.platform !== 'linux' || !windowInstance || windowInstance.isDestroyed()) return;

  windowInstance.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  // Wayland intentionally prevents clients from controlling global placement and
  // stacking. electron-builder launches the packaged app through X11, while this
  // branch keeps development builds usable when no X11 display is available.
  if (!process.env.DISPLAY) {
    console.warn('[desktop] X11 is unavailable; using standard Linux window behavior.');
    return;
  }

  const nativeHandle = windowInstance.getNativeWindowHandle();
  if (nativeHandle.length < 4) return;

  const xid = nativeHandle.readUInt32LE(0);
  let display = null;
  try {
    const api = await loadX11Api();
    display = api.XOpenDisplay(process.env.DISPLAY);
    if (!display) throw new Error(`Cannot open X display ${process.env.DISPLAY}`);

    const root = api.XDefaultRootWindow(display);
    sendWindowState(api, display, root, xid, '_NET_WM_STATE_BELOW', '_NET_WM_STATE_STICKY');
    sendWindowState(api, display, root, xid, '_NET_WM_STATE_SKIP_TASKBAR', '_NET_WM_STATE_SKIP_PAGER');
    api.XFlush(display);
    console.log(`[desktop] Applied X11 desktop widget hints to 0x${xid.toString(16)}`);
  } catch (error) {
    console.warn('[desktop] Could not apply X11 desktop widget hints:', error.message);
  } finally {
    if (display) {
      const api = await loadX11Api();
      api.XCloseDisplay(display);
    }
  }
}
