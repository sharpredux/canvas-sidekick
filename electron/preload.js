const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  closeApp:    () => ipcRenderer.send('close-app'),
  minimizeApp: () => ipcRenderer.send('minimize-app'),
  fetchCanvasData: (url) => ipcRenderer.invoke('fetch-canvas-data', url),
  loginCanvas: (url) => ipcRenderer.send('open-canvas-login', url),
  onCanvasLoginSuccess: (callback) => ipcRenderer.on('canvas-login-success', () => callback()),
  onCanvasLoginFailed: (callback) => ipcRenderer.on('canvas-login-failed', (_event, reason) => callback(reason)),
  startCanvasPolling: (url) => ipcRenderer.send('start-canvas-polling', url),
  onCanvasDataUpdate: (cb) => {
    const listener = (event, data) => cb(data);
    ipcRenderer.on('canvas-data-update', listener);
    return () => ipcRenderer.removeListener('canvas-data-update', listener);
  },
  onCanvasFetchOccurred: (cb) => {
    const listener = (event, timestamp) => cb(timestamp);
    ipcRenderer.on('canvas-fetch-occurred', listener);
    return () => ipcRenderer.removeListener('canvas-fetch-occurred', listener);
  },
  saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  hasSession: () => ipcRenderer.invoke('has-session'),
  onCanvasUnauthorized: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('canvas-unauthorized', listener);
    return () => ipcRenderer.removeListener('canvas-unauthorized', listener);
  },
  getStartupStatus: () => ipcRenderer.invoke('get-startup'),
  setStartupStatus: (enabled) => ipcRenderer.send('set-startup', enabled),
  saveSchedule: (rawText) => ipcRenderer.send('save-schedule', rawText),
  loadSchedule: () => ipcRenderer.invoke('load-schedule'),
  resizeWindow: (sizeName) => ipcRenderer.send('resize-window', sizeName),
  llmChat: (messages) => ipcRenderer.invoke('llm-chat', messages),
  llmParseCommand: (userInput) => ipcRenderer.invoke('llm-parse-command', userInput),
  llmEstimateTask: (taskTitle, deadline) => ipcRenderer.invoke('llm-estimate-task', taskTitle, deadline),
  getArchivedTasks: (dateStr) => ipcRenderer.invoke('get-archived-tasks', dateStr)
});
