// Real host entry point with isolated data and disabled external providers.
const {app,net}=require('electron');
app.commandLine.appendSwitch('ozone-platform','x11');
Object.defineProperty(net,'fetch',{value:async()=>{throw new Error('External provider disabled in the native host test.');}});
require('../../command-center/main.cjs');
