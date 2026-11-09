// Exercise the production adapter with the full Rust application and a synthetic profile.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {createNativeSidekick}=require('../integrations/command-center/native-sidekick.cjs');
const config=JSON.parse(fs.readFileSync(process.env.SIDEKICK_HOST_CONFIG,'utf8'));
app.setPath('userData',config.electronProfile);
app.commandLine.appendSwitch('ozone-platform','x11');
let sidekick,host,toggled=false;
app.whenReady().then(async()=>{
 host=new BrowserWindow({width:900,height:760,webPreferences:{nodeIntegration:false,contextIsolation:true}});
 await host.loadURL('data:text/html,<body style="background:%23eaf4ee">Isolated native Sidekick host test</body>');
 sidekick=createNativeSidekick({window:host,executable:path.resolve(__dirname,'../target/debug/canvas-sidekick'),profile:config.profile,
  onClose:()=>{},onTasks:items=>{
   const task=items.find(i=>i.id==='personal');if(!task)return;
   if(!toggled){toggled=true;sidekick.webContents.send('command-center-toggle-canvas-task','personal');}
   else if(task.completed){console.log(JSON.stringify({type:'tasks-roundtrip',completed:true}));}
  }});
 sidekick.webContents.once('native-ready',event=>console.log(JSON.stringify({...event,type:'host-ready',parent:host.getNativeWindowHandle().readUInt32LE(0)})));
 await sidekick.ready;sidekick.setBounds({x:80,y:100,width:650,height:500});sidekick.setVisible(true);
 setTimeout(()=>{sidekick.setVisible(false);sidekick.setBounds({x:100,y:120,width:600,height:480});sidekick.setVisible(true);},4000);
 setTimeout(()=>{sidekick.webContents.close();},8000);
 sidekick.webContents.once('destroyed',()=>{console.log(JSON.stringify({type:'host-stopped'}));host.close();app.quit();});
});
setTimeout(()=>{console.error('Native host test timed out.');sidekick?.webContents.close();app.exit(1);},12000).unref();
