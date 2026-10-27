'use strict';
const {app,BrowserWindow,shell,ipcMain}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
let mainWindow;
let allowedOrigin='';
const file=()=>path.join(app.getPath('userData'),'server.json');
function validServer(input){
  try{
    const u=new URL(String(input||'').trim());
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
       u.pathname!=='/'||!u.hostname||u.hostname==='localhost'||u.hostname.endsWith('.github.io'))return null;
    return u.origin;
  }catch{return null;}
}
function savedServer(){
  const environmental=validServer(process.env.FAXINGPRO_SERVER_URL);
  if(environmental)return environmental;
  try{return validServer(JSON.parse(fs.readFileSync(file(),'utf8')).server);}catch{return null;}
}
function saveServer(origin){
  const p=file();fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,JSON.stringify({server:origin}),'utf8');
}
function showConnect(){
  allowedOrigin='';
  if(mainWindow)mainWindow.loadFile(path.join(__dirname,'connect.html'));
}
async function useServer(origin){
  const current=validServer(origin);
  if(!current)throw Error('Enter the HTTPS address of your own FaxingPro server (no path or credentials).');
  allowedOrigin=current;
  // The real HTTP login takes place on this HTTPS origin, never inside the file:// shell.
  await mainWindow.loadURL(current);
  saveServer(current);
}
function createWindow(){
  mainWindow=new BrowserWindow({
    width:1460,height:930,minWidth:840,minHeight:650,
    backgroundColor:'#f5f8fc',title:'FaxingPro — ATLAS',
    autoHideMenuBar:true,
    webPreferences:{
      nodeIntegration:false,contextIsolation:true,sandbox:true,
      preload:path.join(__dirname,'preload.cjs')
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    if(/^https:\/\//.test(url)){shell.openExternal(url).catch(()=>{});}
    return {action:'deny'};
  });
  mainWindow.webContents.on('will-navigate',(event,url)=>{
    try{
      const destination=new URL(url);
      if(destination.protocol==='file:'&&destination.pathname===path.join(__dirname,'connect.html'))return;
      if(allowedOrigin&&destination.origin===allowedOrigin&&destination.protocol==='https:')return;
    }catch{}
    event.preventDefault();
  });
  const origin=savedServer();
  if(origin){
    useServer(origin).catch(()=>{
      showConnect();
      mainWindow.webContents.once('did-finish-load',()=>{
        mainWindow.webContents.send('server-error','Could not connect to that server. Verify its HTTPS address and connectivity.');
      });
    });
  }else showConnect();
}
ipcMain.handle('faxingpro:connect',async(event,address)=>{
  if(!mainWindow||event.sender!==mainWindow.webContents||
     !event.sender.getURL().startsWith('file://'))throw Error('Only the local setup screen can change servers.');
  await useServer(address);
  return {ok:true};
});
app.whenReady().then(()=>{
  createWindow();
  app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
