import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT || 8088);
const host = process.env.HOST || '0.0.0.0';
const token = process.env.API_TOKEN || '';
const transport = process.env.FAX_TRANSPORT || 'disabled';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean);

if (token.length < 32 || /^(REPLACE_WITH_|PASTE_|YOUR_|CHANGE_ME)/i.test(token)) {
  console.error('Refusing to start: API_TOKEN must be a new random secret of at least 32 characters, not an example placeholder.');
  process.exit(1);
}
if (transport !== 'disabled') {
  console.error('Refusing to start: only FAX_TRANSPORT=disabled is implemented. No real fax gateway is bundled in v0.1.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid PORT');
  process.exit(1);
}

const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const authenticate=(req)=>{
  const supplied=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  const a=Buffer.from(supplied),b=Buffer.from(token);
  return a.length===b.length && timingSafeEqual(a,b);
};
const server=http.createServer((req,res)=>{
  const origin=req.headers.origin;
  if(origin && allowedOrigins.includes(origin)){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  }
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  const pathname=new URL(req.url||'/', 'http://localhost').pathname;
  if(req.method==='OPTIONS'){
    if(origin&&!allowedOrigins.includes(origin)) return reply(res,403,{error:'Origin is not permitted'});
    return reply(res,204,{});
  }
  if(req.method==='GET' && pathname==='/healthz'){
    return reply(res,200,{ok:true,service:'FaxingPro API v0.1',transport,faxEnabled:false});
  }
  if(pathname.startsWith('/api/')){
    if(origin&&!allowedOrigins.includes(origin)) return reply(res,403,{error:'Origin is not permitted'});
    if(!authenticate(req))return reply(res,401,{error:'Unauthorized'});
    if(req.method==='GET' && pathname==='/api/faxes')return reply(res,200,{items:[],mode:'not-configured'});
    if(req.method==='GET' && pathname==='/api/capabilities')return reply(res,200,{inbound:false,outbound:false,drafts:false,transport});
    if(req.method==='POST' && pathname==='/api/faxes')return reply(res,503,{error:'Real fax delivery is disabled. Configure and implement an approved FreeSWITCH/T.38 transport adapter before enabling submission.'});
    return reply(res,404,{error:'Unknown API endpoint'});
  }
  return reply(res,404,{error:'Not found'});
});
server.requestTimeout=15000;
server.headersTimeout=10000;
server.listen(port,host,()=>console.log('FaxingPro API listening on '+host+':'+port+' (transport disabled)'));
