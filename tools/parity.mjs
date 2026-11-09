import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {isAssignmentCompleted} from '../baseline/canvasTasks.js';
import {applyCompletion} from '../baseline/taskCompletion.js';
const cases=[],expected=[];
for(const types of [[],['online_upload'],['on_paper'],['external_tool'],['none'],['not_graded'],['on_paper','online_upload']])
for(const workflow_state of ['unsubmitted','submitted','pending_review','graded'])
for(const score of [null,0,90,'0','90'])
for(const missing of [undefined,false,true])
for(const extra of [{},{excused:true},{redo_request:true},{submitted_at:'2026-10-01'},{attempt:1,submission_type:'online_upload'},{late_policy_status:'missing'}]) {
 const assignment={submission_types:types,has_submitted_submissions:true};const submission={workflow_state,score,missing,...extra};
 cases.push({op:'completed',assignment,submission});expected.push(isAssignmentCompleted(assignment,submission));
}
for(const known of [undefined,false,true])for(const completed of [false,true])for(const canvas of [false,true])for(const manual of [false,true])for(const local of [false,true]) {
 const item={id:'task',type:'deadline',completionKnown:known,completed,isManual:manual};const previous={id:'task',completed:!canvas,canvasCompleted:canvas};const overrides={task:{completed:local,canvasCompleted:canvas}};
 const result=applyCompletion(item,overrides,previous);cases.push({op:'apply',item,previous,overrides:{task:{completed:local,canvasCompleted:canvas}}});expected.push({completed:result.completed,canvasCompleted:result.canvasCompleted,overrides});
}
const result=spawnSync('target/debug/parity-driver',[],{cwd:new URL('..',import.meta.url),input:cases.map(JSON.stringify).join('\n')+'\n',encoding:'utf8',maxBuffer:32*1024*1024,timeout:15000});
assert.equal(result.status,0,result.stderr);const actual=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(actual.length,expected.length);
for(let i=0;i<cases.length;i++)assert.deepEqual(actual[i],expected[i],JSON.stringify(cases[i]));console.log(`${cases.length} differential completion cases passed`);
