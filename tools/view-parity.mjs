import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {parseScheduleTSV} from '../baseline/scheduleParser.js';
const source=readFileSync(new URL('../baseline/App.jsx',import.meta.url),'utf8');
const body=source.split('const filteredItems = useMemo(() => {')[1].split('}, [items, activeTab, scheduleCourses, lastRefreshTime]);')[0];
const original=new Function('items','activeTab','scheduleCourses','lastRefreshTime','Date',body);
const cases=[],expected=[];
for(const now of ['2026-11-09T00:00:00+08:00','2026-11-09T15:30:00+08:00','2026-11-10T00:00:00+08:00']) {
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return new Date(now).getTime();}}
 const time=new Date(now).getTime();
 let items=[];let n=0;
 for(const type of ['deadline','event','announcement','comment'])for(const completed of [false,true])for(const course of ['CS 101','MATH 202','Personal'])for(const delta of [-172800000,-1,0,1,3600000,172800000]){items.push({id:String(++n),type,completed,course,dueDate:new Date(time+delta).toISOString(),zoomLink:'https://zoom.us/j/123'});}
 for(const tab of ['Up Next','Tasks','Updates','Calendar'])for(const schedule of [[],[{day:'MON',courseCode:'CS',isOnline:true}],[{day:'TUE',courseCode:'CS',isOnline:false}]]){
  cases.push({op:'view',items,tab,schedule,now});expected.push(original(items,tab,schedule,0,Clock).map(i=>({id:i.id,zoomLink:i.zoomLink??null})));
 }
}
const raw='Time Slot\tMon 08/06\tTue 09/06\n7:30AM - 9:00AM\t- CS - Computer Science Offline Venue : Online Teacher : Jane Doe Room No :\t- MATH - Algebra Venue : Room 4 Teacher : John';
cases.push({op:'schedule',raw});expected.push(parseScheduleTSV(raw).map(({id,...course})=>course));
const r=spawnSync('target/debug/parity-driver',[],{cwd:new URL('..',import.meta.url),input:cases.map(JSON.stringify).join('\n')+'\n',encoding:'utf8',maxBuffer:32*1024*1024,timeout:15000});assert.equal(r.status,0,r.stderr);const actual=r.stdout.trim().split('\n').map(JSON.parse);assert.equal(actual.length,expected.length);for(let i=0;i<cases.length;i++)assert.deepEqual(actual[i],expected[i],`Case ${i}: ${cases[i].op}/${cases[i].tab}`);console.log(`${cases.length} differential view/schedule scenarios passed (${cases[0].items.length} items per view)`);
