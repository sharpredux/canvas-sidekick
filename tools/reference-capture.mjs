import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const require=createRequire(new URL('../../canvas-sidekick/package.json',import.meta.url));
const { _electron }=require('playwright');
const root=path.resolve(import.meta.dirname,'..');
const fixtureDirectory=process.argv.includes('--hosted')?'native-hosted':process.argv.includes('--medium')?'ui':'native';
let fixture;
try{fixture=JSON.parse(await fs.readFile(path.join(root,`artifacts/${fixtureDirectory}/fixture.json`),'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;fixture=JSON.parse(await fs.readFile(path.join(root,'artifacts/ui/fixture.json'),'utf8'));}
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'sidekick-visual-reference-'));
const configuration=path.join(profile,'config.json');
await fs.writeFile(configuration,JSON.stringify({...fixture,profile,hosted:process.argv.includes('--hosted')}));
const output=path.join(root,process.argv.includes('--hosted')?'artifacts/reference-hosted':'artifacts/reference');await fs.mkdir(output,{recursive:true});
let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'tools/reference-ui.cjs')],env:{...process.env,SIDEKICK_REFERENCE_CONFIG:configuration}});
 const page=await app.firstWindow();
 await page.addInitScript(({now})=>{const OriginalDate=Date;globalThis.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return new OriginalDate(now).getTime();}};},{now:fixture.now});
 await page.reload();await page.locator('.agenda-item').first().waitFor();
 const sizes=process.argv.includes('--medium')?['Medium']:process.argv.includes('--small')?['Small']:process.argv.includes('--large')?['Large']:['Small','Medium','Large'];
 const texts=process.argv.includes('--largest')?['Largest']:process.argv.includes('--medium')?['Standard']:['Standard','Larger','Largest'];
 for(const size of sizes)for(const textSize of texts){
  await app.evaluate(()=>{globalThis.sidekickReference.ai='ready';});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:size,exact:true}).click();
  await page.getByRole('combobox',{name:'Text size'}).selectOption(textSize);
  const expected=process.argv.includes('--hosted')?[650,500]:{Small:[280,320],Medium:[360,520],Large:[480,640]}[size];
  await page.waitForFunction(([width,height])=>innerWidth===width&&innerHeight===height,expected);
  for(const [name,label] of [['up-next','Up Next'],['tasks','Tasks'],['updates','Updates'],['calendar','Calendar'],['settings','Settings'],['ai-chat','AI Chat']]){
   await page.getByRole('button',{name:label,exact:true}).click();
   await page.mouse.move(0,0);await page.waitForTimeout(450);
   await page.screenshot({path:path.join(output,`${size}-${textSize}-${name}.png`)});
   const metrics=await page.evaluate(()=>[...document.querySelectorAll('.tabs,.content-area,.agenda-item-card,.item-course,.item-title,.item-time-text,.item-estimate,.ai-chat,.schedule-settings')].map(element=>{const {x,y,width,height}=element.getBoundingClientRect();const style=getComputedStyle(element);return {selector:element.className,x,y,width,height,font:style.font,color:style.color,padding:style.padding,gap:style.gap};}));
   await fs.writeFile(path.join(output,`${size}-${textSize}-${name}.json`),JSON.stringify(metrics,null,2));
   if(name==='tasks'){
    const variables=await page.locator('.app-container').evaluate(element=>{const style=getComputedStyle(element);return Object.fromEntries(['--widget-metadata-size','--md-sys-typescale-label-small','--md-sys-typescale-font'].map(name=>[name,style.getPropertyValue(name)]));});
    await fs.writeFile(path.join(output,`${size}-${textSize}-variables.json`),JSON.stringify(variables,null,2));
   }
  }
  if(process.argv.includes('--details')){
   const shot=async name=>{await page.mouse.move(0,0);await page.waitForTimeout(name==='auth-success'?100:200);await page.screenshot({path:path.join(output,`${size}-${textSize}-${name}.png`)});};
   await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.locator('.app-container').hover();await page.locator('.fab').click();await shot('form');
   if(process.argv.includes('--picker')){const date=page.locator('input[name="date"]');const box=await date.boundingBox();await date.click({position:{x:box.width-20,y:box.height/2}});await shot('form-picker');if(process.argv.includes('--year')){const xid=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));const clicked=spawnSync('python3',[path.join(root,'tools/x11-click.py'),String(xid),String(box.x+70),String(box.y+box.height+24)]);if(clicked.status!==0)throw new Error(clicked.stderr.toString());await shot('form-year');}await page.keyboard.press('Escape');await page.keyboard.press('Escape');}
   if(process.argv.includes('--required')){await page.getByRole('button',{name:'Add Task',exact:true}).click();await shot('form-required');await page.keyboard.press('Escape');}
   await page.getByRole('button',{name:'Close',exact:true}).click();
   await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:'Import',exact:true}).click();await shot('import');
   const schedule='Time Slot\tMon 08/06\tTue 09/06\n7:30AM - 9:00AM\t- CCINOV8 - INNOVATION Offline Venue : Online Teacher : Melvin Gabriel Ignacio Room No :\t- CCINOV8 - INNOVATION Offline Venue : Online Teacher : Melvin Gabriel Ignacio Room No :';
   await page.getByPlaceholder('Paste schedule table...').fill(schedule);await page.getByPlaceholder('Paste schedule table...').press('Control+Home');await shot('import-filled');await page.getByRole('button',{name:'View',exact:true}).click();await shot('schedule');await page.getByRole('button',{name:'Back to calendar',exact:true}).click();
   const day=new Date(fixture.items.find(i=>i.type==='deadline').dueDate).getDate();await page.locator('div[style*="border-radius: 50%"]',{}).filter({hasText:new RegExp(`^${day}$`)}).first().click();await shot('day');
   for(const [state,name] of [['offline','ai-offline'],['model','ai-model']]){
    await app.evaluate((_,state)=>{globalThis.sidekickReference.ai=state;},state);await page.getByRole('button',{name:'Tasks',exact:true}).click();await page.getByRole('button',{name:'AI Chat',exact:true}).click();await page.getByText(state==='offline'?'Ollama Not Found':'Model Required',{exact:true}).waitFor();await shot(name);
   }
   await page.getByRole('button',{name:'Download Model',exact:true}).click();await page.getByText('42%',{exact:true}).waitFor();await shot('ai-pull');
   await page.evaluate(()=>window.api.saveSettings({schoolUrl:''}));await page.reload();await page.getByRole('heading',{name:'Connect to Canvas'}).waitFor();await shot('auth-idle');await page.getByRole('textbox',{name:'Canvas URL'}).fill('canvas.example.edu');await page.getByRole('button',{name:'Log in',exact:true}).click();await page.getByRole('button',{name:'Waiting...',exact:true}).waitFor();await shot('auth-waiting');
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('canvas-login-failed','invalid-url'));await page.getByRole('alert').waitFor();await shot('auth-error');
   await app.evaluate(({BrowserWindow},origin)=>BrowserWindow.getAllWindows()[0].webContents.send('canvas-login-success',origin),fixture.settings.schoolUrl);await page.getByText('Authenticated Successfully!',{exact:true}).waitFor();await shot('auth-success');await page.locator('.auth-modal').waitFor({state:'hidden'});
  }
 }
 console.log(`PASS: ${sizes.length*texts.length*(process.argv.includes('--details')?18+Number(process.argv.includes('--picker'))+Number(process.argv.includes('--year'))+Number(process.argv.includes('--required')):6)} reference screenshots captured from the Electron renderer at verified viewport sizes.`);
}finally{if(app)await app.close();await fs.rm(profile,{recursive:true,force:true});}
