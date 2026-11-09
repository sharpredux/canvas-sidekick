// Isolated reference renderer: actual Electron UI, synthetic IPC, no production profile.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const config=JSON.parse(fs.readFileSync(process.env.SIDEKICK_REFERENCE_CONFIG,'utf8'));
globalThis.sidekickReference=config;
app.setPath('userData',config.profile);
app.commandLine.appendSwitch('ozone-platform','x11');
let settings={...config.settings},window;
for(const [channel,value] of Object.entries({
 'load-settings':()=>settings,'has-session':()=>true,'load-schedule':()=>'',
 'fetch-canvas-data':event=>{event.sender.send('canvas-fetch-occurred',Date.parse(config.now));return config.items;},'get-startup':()=>false,'get-archived-tasks':()=>[],
 'ollama-version':()=>{if(config.ai==='offline')throw new Error('Synthetic offline state');return {version:'test'};},'ollama-tags':()=>({models:config.ai&&config.ai!=='ready'?[]:[{name:'qwen2.5:3b'}]}),
 'llm-estimate-task':()=>({difficulty:'medium',estimatedHours:2}),
 'llm-chat':()=>({message:{content:'Synthetic study assistant reply'}}),'llm-parse-command':()=>({intent:'unknown'})
}))ipcMain.handle(channel,event=>value(event));
ipcMain.handle('ollama-pull',event=>new Promise(resolve=>{event.sender.send('ollama-pull-progress',42);setTimeout(()=>resolve({status:'success'}),30000).unref();}));
ipcMain.on('save-settings',(_,value)=>{settings={...settings,...value};});
ipcMain.on('resize-window',(_,size)=>{if(config.hosted)return;const dimensions={Small:[280,320],Medium:[360,520],Large:[480,640]}[size];window.setResizable(true);window.setSize(...dimensions);window.setResizable(false);});
app.whenReady().then(async()=>{
 window=new BrowserWindow({width:config.hosted?650:360,height:config.hosted?500:520,frame:false,transparent:true,resizable:false,webPreferences:{preload:path.resolve(__dirname,'../../canvas-sidekick/electron/preload.js'),contextIsolation:true,nodeIntegration:false}});
 if(config.hosted){
  const {pathToFileURL}=require('node:url');
  const css=fs.readFileSync(path.resolve(__dirname,'../../command-center/renderer/sidekick-theme.css'),'utf8').replace('__MANROPE_URL__',pathToFileURL(path.resolve(__dirname,'../assets/fonts/Manrope-variable.ttf')).href);
  window.webContents.on('did-finish-load',()=>window.webContents.insertCSS(css));
 }
 await window.loadFile(path.resolve(__dirname,'../../canvas-sidekick/dist/index.html'));
});
app.on('window-all-closed',()=>app.quit());
