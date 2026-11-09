// Isolated reference renderer: actual Electron UI, synthetic IPC, no production profile.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const config=JSON.parse(fs.readFileSync(process.env.SIDEKICK_REFERENCE_CONFIG,'utf8'));
app.setPath('userData',config.profile);
app.commandLine.appendSwitch('ozone-platform','x11');
let settings={...config.settings},window;
for(const [channel,value] of Object.entries({
 'load-settings':()=>settings,'has-session':()=>true,'load-schedule':()=>'',
 'fetch-canvas-data':event=>{event.sender.send('canvas-fetch-occurred',Date.parse(config.now));return config.items;},'get-startup':()=>false,'get-archived-tasks':()=>[],
 'ollama-version':()=>({version:'test'}),'ollama-tags':()=>({models:[{name:'qwen2.5:3b'}]}),
 'llm-estimate-task':()=>({difficulty:'medium',estimatedHours:2}),
 'llm-chat':()=>({message:{content:'Synthetic study assistant reply'}}),'llm-parse-command':()=>({intent:'unknown'})
}))ipcMain.handle(channel,event=>value(event));
ipcMain.on('save-settings',(_,value)=>{settings={...settings,...value};});
ipcMain.on('resize-window',(_,size)=>{const dimensions={Small:[280,320],Medium:[360,520],Large:[480,640]}[size];window.setSize(...dimensions);});
app.whenReady().then(async()=>{
 window=new BrowserWindow({width:360,height:520,frame:false,transparent:true,resizable:false,webPreferences:{preload:path.resolve(__dirname,'../../canvas-sidekick/electron/preload.js'),contextIsolation:true,nodeIntegration:false}});
 await window.loadFile(path.resolve(__dirname,'../../canvas-sidekick/dist/index.html'));
});
app.on('window-all-closed',()=>app.quit());
