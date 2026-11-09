import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require=createRequire(new URL('../../canvas-sidekick/package.json',import.meta.url));
const { _electron }=require('playwright');
const root=path.resolve(import.meta.dirname,'..');
const fixture=JSON.parse(await fs.readFile(path.join(root,'artifacts/ui/fixture.json'),'utf8'));
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'sidekick-visual-reference-'));
const configuration=path.join(profile,'config.json');
await fs.writeFile(configuration,JSON.stringify({...fixture,profile}));
const output=path.join(root,'artifacts/reference');await fs.mkdir(output,{recursive:true});
let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'tools/reference-ui.cjs')],env:{...process.env,SIDEKICK_REFERENCE_CONFIG:configuration}});
 const page=await app.firstWindow();
 await page.addInitScript(({now})=>{const OriginalDate=Date;globalThis.Date=class extends OriginalDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return new OriginalDate(now).getTime();}};},{now:fixture.now});
 await page.reload();await page.locator('.agenda-item').first().waitFor();
 for(const size of ['Small','Medium','Large'])for(const textSize of ['Standard','Larger','Largest']){
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:size,exact:true}).click();
  await page.getByRole('combobox',{name:'Text size'}).selectOption(textSize);
  for(const [name,label] of [['up-next','Up Next'],['tasks','Tasks'],['updates','Updates'],['calendar','Calendar'],['settings','Settings'],['ai-chat','AI Chat']]){
   await page.getByRole('button',{name:label,exact:true}).click();
   await page.mouse.move(0,0);await page.waitForTimeout(450);
   await page.screenshot({path:path.join(output,`${size}-${textSize}-${name}.png`)});
   const metrics=await page.evaluate(()=>[...document.querySelectorAll('.tabs,.content-area,.agenda-item-card,.item-course,.item-title,.item-time-text,.item-estimate,.ai-chat,.schedule-settings')].map(element=>{const {x,y,width,height}=element.getBoundingClientRect();const style=getComputedStyle(element);return {selector:element.className,x,y,width,height,font:style.font,color:style.color,padding:style.padding,gap:style.gap};}));
   await fs.writeFile(path.join(output,`${size}-${textSize}-${name}.json`),JSON.stringify(metrics,null,2));
  }
 }
 console.log('PASS: 54 deterministic reference screenshots and layout measurements captured from the Electron renderer.');
}finally{if(app)await app.close();await fs.rm(profile,{recursive:true,force:true});}
