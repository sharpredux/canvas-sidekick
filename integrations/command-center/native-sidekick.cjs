// Native Sidekick adapter for Command Center. All transport stays in child-process pipes.
const {spawn}=require('node:child_process');
const {EventEmitter}=require('node:events');
const readline=require('node:readline');
function createNativeSidekick({window,executable,profile,onTasks,onClose}){
 const contents=new EventEmitter();let ready=false,visible=false,bounds={x:256,y:76,width:900,height:700},stopped=false;
 const handle=window.getNativeWindowHandle();
 const parent=process.platform==='win32'?handle.readBigUInt64LE(0).toString():String(handle.readUInt32LE(0));
 const child=spawn(executable,['--profile',profile,'--hosted-parent',parent],{stdio:['pipe','pipe','pipe'],env:{...process.env,CANVAS_SIDEKICK_PROFILE:profile}});
 const send=command=>{if(!stopped&&!child.stdin.destroyed)child.stdin.write(JSON.stringify({v:1,...command})+'\n');};
 const apply=()=>{send({type:'bounds',...bounds});send({type:'visible',visible});};
 const started=new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>{child.kill();reject(new Error('Native Sidekick did not become ready.'));},15000);timeout.unref();
  readline.createInterface({input:child.stdout}).on('line',line=>{
   let event;try{event=JSON.parse(line);}catch{return;}
   if(event.v!==1)return;
   if(event.type==='ready'){ready=true;clearTimeout(timeout);apply();contents.emit('native-ready',event);resolve();}
   if(event.type==='tasks'&&Array.isArray(event.tasks))onTasks(event.tasks);
   if(event.type==='close-request'){visible=false;apply();onClose();}
  });
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{stopped=true;clearTimeout(timeout);if(!ready)reject(new Error('Native Sidekick exited before initialization ('+code+').'));contents.emit('destroyed');});
 });
 // Only operational errors reach the host log; never forward task snapshots or session data.
 child.stderr.on('data',()=>{});
 child.stdin.on('error',()=>{});
 contents.send=(channel,id)=>{if(channel==='command-center-toggle-canvas-task'&&typeof id==='string')send({type:'toggle',id});};
 contents.close=()=>{send({type:'quit'});const timeout=setTimeout(()=>{if(!stopped)child.kill();},3000);timeout.unref();};
 return {ready:started,webContents:contents,setVisible(value){visible=Boolean(value);if(ready)apply();},setBounds(value){bounds={x:Math.round(value.x),y:Math.round(value.y),width:Math.max(1,Math.round(value.width)),height:Math.max(1,Math.round(value.height))};if(ready)apply();}};
}
module.exports={createNativeSidekick};
