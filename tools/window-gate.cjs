// Run using Electron. This isolated host never loads either production profile.
const {app,BrowserWindow}=require('electron');
const {spawn}=require('node:child_process');
const {mkdtempSync}=require('node:fs');const os=require('node:os');const path=require('node:path');
app.setPath('userData',mkdtempSync(path.join(os.tmpdir(),'sidekick-host-gate-')));
app.commandLine.appendSwitch('ozone-platform','x11');
app.whenReady().then(async()=>{
 const host=new BrowserWindow({width:900,height:760,webPreferences:{nodeIntegration:false,contextIsolation:true}});
 await host.loadURL('data:text/html,<body style="background:%23eaf4ee;font:20px sans-serif">Isolated native Sidekick host gate</body>');
 const native=host.getNativeWindowHandle().readUInt32LE(0);
 const child=spawn(path.resolve(__dirname,'../target/debug/native-window-gate'),['--parent',String(native),'--seconds','8'],{stdio:['pipe','pipe','inherit']});
 child.stdout.on('data',bytes=>{process.stdout.write(bytes);child.stdin.write(JSON.stringify({type:'bounds',x:80,y:100,width:650,height:500})+'\n');});
 child.on('exit',code=>{console.log(JSON.stringify({type:'host-gate-exit',code}));app.quit();});
 host.on('closed',()=>child.kill());
});
