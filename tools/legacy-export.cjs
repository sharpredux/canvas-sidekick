// One-time migration bridge. Run in the legacy Electron runtime with private stdin/stdout pipes.
// The legacy profile is locked, copied, and read through Chromium using its original file URL.
const {app,BrowserWindow,session,safeStorage}=require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
let snapshot;
function readJSON(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
function hasLiveLinuxDatabaseLock(profile){
 if(process.platform!=='linux')return false;
 let locks;try{locks=fs.readFileSync('/proc/locks','utf8');}catch{return false;}
 for(const name of ['Local Storage/leveldb/LOCK','LocalStorage/leveldb/LOCK','Session Storage/LOCK']){
  let stat;try{stat=fs.statSync(path.join(profile,name),{bigint:true});}catch{continue;}
  const major=((stat.dev>>8n)&0xfffn)|((stat.dev>>32n)&0xfffff000n);
  const minor=(stat.dev&0xffn)|((stat.dev>>12n)&0xffffff00n);
  for(const line of locks.split('\n')){
   const fields=line.trim().split(/\s+/);const identity=fields.find(field=>/^[0-9a-f]+:[0-9a-f]+:\d+$/i.test(field));
   if(!identity)continue;const[a,b,inode]=identity.split(':');
   if(BigInt('0x'+a)===major&&BigInt('0x'+b)===minor&&BigInt(inode)===stat.ino)return true;
  }
 }
 return false;
}
async function run(config){
 if(!config.profile||!config.renderer)throw new Error('Migration needs the legacy profile and renderer paths.');
 if(process.stdout.isTTY)throw new Error('Migration output must use a private pipe.');
 if(hasLiveLinuxDatabaseLock(config.profile))throw new Error('Close the legacy Sidekick and Command Center before migration.');
 app.setName('canvas-sidekick');app.setPath('userData',path.resolve(config.profile));
 if(!app.requestSingleInstanceLock())throw new Error('Close the legacy Sidekick and Command Center before migration.');
 snapshot=fs.mkdtempSync(path.join(config.snapshotRoot||os.tmpdir(),'sidekick-legacy-export-'));
 fs.cpSync(config.profile,snapshot,{recursive:true,filter:source=>!['SingletonLock','SingletonCookie','SingletonSocket','Cache','Code Cache','GPUCache','DawnCache'].includes(path.basename(source))});
 app.setPath('userData',snapshot);
 await app.whenReady();
 // Block scripts and remote requests so the old app cannot poll, estimate, or change its state.
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.resourceType==='script'||/^https?:/.test(details.url)}));
 const window=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 await window.loadFile(path.resolve(config.renderer));
 const storage=await window.webContents.executeJavaScript(`Object.fromEntries(['manualTasks','taskCompletionOverrides','localCompletedIds'].map(key=>[key,localStorage.getItem(key)]))`);
 const parse=(key,fallback)=>storage[key]===null?fallback:JSON.parse(storage[key]);
 const settings=readJSON(path.join(snapshot,'settings.json'),{});
 const archives={};const archiveDir=path.join(snapshot,'archive');
 if(fs.existsSync(archiveDir))for(const file of fs.readdirSync(archiveDir)){if(/^\d{4}-\d{2}-\d{2}\.json$/.test(file))archives[file.slice(0,-5)]=readJSON(path.join(archiveDir,file),[]);}
 let cookies=[];
 if(settings.schoolUrl){
  const origin=new URL(settings.schoolUrl).origin;
  cookies=await session.defaultSession.cookies.get({url:origin});
  const cookieFile=path.join(snapshot,'canvas_cookie');
  if(!cookies.some(c=>c.name==='canvas_session')&&fs.existsSync(cookieFile)){
   if(!safeStorage.isEncryptionAvailable())throw new Error('Unlock the legacy credential store to migrate the Canvas session.');
   cookies.push({name:'canvas_session',value:safeStorage.decryptString(fs.readFileSync(cookieFile)),domain:new URL(origin).hostname,path:'/',secure:true,httpOnly:true});
  }
 }
 const payload={version:1,userAgent:window.webContents.getUserAgent(),settings,manualTasks:parse('manualTasks',[]),taskCompletionOverrides:parse('taskCompletionOverrides',null),localCompletedIds:parse('localCompletedIds',[]),schedule:fs.existsSync(path.join(snapshot,'schedule.txt'))?fs.readFileSync(path.join(snapshot,'schedule.txt'),'utf8'):'',archives,cookies};
 window.destroy();
 await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(payload)+'\n',error=>error?reject(error):resolve()));
 app.quit();
}
app.setName('canvas-sidekick');
try {
 const input=[];const byte=Buffer.alloc(1);
 while(input.length<1024*1024&&fs.readSync(0,byte,0,1,null)>0){if(byte[0]===10)break;input.push(byte[0]);}
 run(JSON.parse(Buffer.from(input).toString('utf8'))).catch(fail);
}catch(error){fail(error);}
function fail(error){process.stderr.write('Legacy migration failed: '+error.message+'\n');app.exit(1);}
app.on('will-quit',()=>{if(snapshot)try{fs.rmSync(snapshot,{recursive:true,force:true});}catch{ /* Locked files are removed by the migration launcher after exit. */ }});
