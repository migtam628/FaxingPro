'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('faxingproDesktop',{
  connect:(server)=>ipcRenderer.invoke('faxingpro:connect',server),
  onError:(cb)=>ipcRenderer.on('server-error',(_event,msg)=>cb(msg))
});
