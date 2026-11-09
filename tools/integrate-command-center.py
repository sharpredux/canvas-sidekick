#!/usr/bin/env python3
"""Install the opt-in native host adapter while preserving the reference host."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
host = root.parent / 'command-center'
main = host / 'main.cjs'
source = main.read_text()
marker = "if(process.env.CANVAS_SIDEKICK_RUST==='1')"
backup = root / 'baseline/command-center-main.cjs'
if marker not in source:
    start = source.index("const sidekickRoot=path.join(__dirname,'vendor/sidekick');")
    end_text = "await sidekick.webContents.loadFile(path.join(sidekickRoot,'dist/index.html'));"
    end = source.index(end_text, start) + len(end_text)
    legacy = source[start:end]
    if not backup.exists():
        backup.write_text(source)
    native = """if(process.env.CANVAS_SIDEKICK_RUST==='1'){
const {createNativeSidekick}=require('./lib/native-sidekick.cjs');
const executable=process.env.CANVAS_SIDEKICK_EXECUTABLE||path.join(process.resourcesPath,'native-sidekick',process.platform==='win32'?'canvas-sidekick.exe':'canvas-sidekick');
const profile=process.env.CANVAS_SIDEKICK_PROFILE||(process.env.COMMAND_CENTER_TEST_DATA?path.join(dataDir,'sidekick-rust'):path.join(app.getPath('appData'),'canvas-sidekick-rust'));
sidekick=createNativeSidekick({window:win,executable,profile,onClose:()=>emit('navigate','Dashboard'),onTasks:items=>{
state.canvasTasks=items.filter(item=>item&&typeof item.id==='string'&&item.id.length<200&&typeof item.title==='string').slice(0,2000).map(item=>({id:`canvas:${item.id}`,sidekickId:item.id,title:item.title.slice(0,500),course:String(item.course||'').slice(0,200),dueDate:typeof item.dueDate==='string'?item.dueDate:'',completed:Boolean(item.completed),url:typeof item.schoolUrl==='string'?item.schoolUrl:''}));
save();emit('canvas-tasks',state.canvasTasks);
}});await sidekick.ready;
}else{"""
    main.write_text(source[:start] + native + legacy + '}' + source[end:])
shutil.copyfile(root / 'integrations/command-center/native-sidekick.cjs', host / 'lib/native-sidekick.cjs')
print('Installed opt-in native adapter; enable with CANVAS_SIDEKICK_RUST=1 and CANVAS_SIDEKICK_EXECUTABLE.')
