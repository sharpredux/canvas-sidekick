const {app,BrowserWindow,session,safeStorage}=require('electron');const fs=require('node:fs');const path=require('node:path');
app.setName('canvas-sidekick');const config=JSON.parse(fs.readFileSync(0,'utf8'));app.setPath('userData',config.profile);
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});await window.loadFile(config.renderer);
 await window.webContents.executeJavaScript(`localStorage.setItem('manualTasks',JSON.stringify([{id:'personal',isManual:true,title:'Migration fixture'}]));localStorage.setItem('taskCompletionOverrides',JSON.stringify({personal:{completed:false,canvasCompleted:true}}));`);
 fs.writeFileSync(path.join(config.profile,'settings.json'),JSON.stringify({size:'Large',textSize:'Largest',schoolUrl:'https://canvas.migration.example',future:42}));
 fs.writeFileSync(path.join(config.profile,'schedule.txt'),'synthetic schedule');fs.mkdirSync(path.join(config.profile,'archive'),{recursive:true});fs.writeFileSync(path.join(config.profile,'archive/2026-11-09.json'),JSON.stringify([{id:'archive',type:'deadline',completed:true}]));
 if(!safeStorage.isEncryptionAvailable())throw new Error('Encryption unavailable for synthetic migration test');fs.writeFileSync(path.join(config.profile,'canvas_cookie'),safeStorage.encryptString('synthetic-cookie'));
 await session.defaultSession.cookies.set({url:'https://canvas.migration.example',name:'canvas_session',value:'synthetic-cookie',secure:true,httpOnly:true,path:'/'});await session.defaultSession.cookies.flushStore();
 window.destroy();app.quit();
}).catch(error=>{console.error(error.message);app.exit(1);});
