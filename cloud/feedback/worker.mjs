import {authorizeOwner} from './auth.mjs';
export const MAX_BYTES=8*1024*1024;
const DAY=86400000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=(status,code)=>{throw Object.assign(new Error(code),{status,code})};
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
export const sha256=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
// Reject duplicate object keys at every depth, including escaped equivalents.
export function parseUnique(text){
 let i=0;const ws=()=>{while(/\s/.test(text[i]||'')&&i<text.length)i++};
 function string(){const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue}if(text[i++]==='"')return JSON.parse(text.slice(start,i))}fail(400,'json_invalid')}
 function value(depth=0){if(depth>16)fail(400,'json_depth');ws();let c=text[i];if(c==='"'){string();return}if(c==='{'){i++;ws();const keys=new Set();if(text[i]==='}'){i++;return}while(i<text.length){ws();if(text[i]!=='"')fail(400,'json_invalid');const k=string();if(keys.has(k))fail(400,'duplicate_key');keys.add(k);ws();if(text[i++]!==':')fail(400,'json_invalid');value(depth+1);ws();c=text[i++];if(c==='}')return;if(c!==',')fail(400,'json_invalid')}fail(400,'json_invalid')}
 if(c==='['){i++;ws();if(text[i]===']'){i++;return}while(i<text.length){value(depth+1);ws();c=text[i++];if(c===']')return;if(c!==',')fail(400,'json_invalid')}fail(400,'json_invalid')}
 const m=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!m)fail(400,'json_invalid');i+=m[0].length;}
 try{value();ws();if(i!==text.length)fail(400,'json_invalid');return JSON.parse(text)}catch(e){if(e.status)throw e;fail(400,'json_invalid')}
}
function exact(x,keys){return x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k))}
export function validate(x){
 if(!exact(x,['version','id','kind','title','description','transcript','logs','screenshot'])||x.version!==2||!uuid.test(x.id)||!['bug','feature'].includes(x.kind))fail(400,'report_invalid');
 for(const [k,n] of [['title',200],['description',20000],['transcript',50000],['logs',200000]])if(x[k]!==undefined&&(typeof x[k]!=='string'||[...x[k]].length>n))fail(400,'report_invalid');
 if(!x.title?.trim())fail(400,'title_required');
 if(x.screenshot!==undefined){const s=x.screenshot;if(!exact(s,['mime','base64'])||s.mime!=='image/png'||typeof s.base64!=='string'||s.base64.length>Math.ceil(4*1024*1024/3)*4||!s.base64.length||s.base64.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s.base64))fail(400,'screenshot_invalid');
 let b;try{b=atob(s.base64)}catch{fail(400,'screenshot_invalid')}if(b.length>4*1024*1024||b.length<33||[137,80,78,71,13,10,26,10].some((v,i)=>b.charCodeAt(i)!==v)||b.slice(12,16)!=='IHDR')fail(400,'screenshot_invalid');
 const a=Uint8Array.from(b,c=>c.charCodeAt(0)),v=new DataView(a.buffer);if(v.getUint32(8)!==13||!v.getUint32(16)||!v.getUint32(20)||v.getUint32(16)>8192||v.getUint32(20)>8192)fail(400,'screenshot_invalid');
 }
 return x;
}
async function bounded(req){
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||(req.headers.has('content-encoding')&&req.headers.get('content-encoding')!=='identity'))fail(415,'json_required');
 const cl=req.headers.get('content-length');if(cl!==null&&(!/^\d+$/.test(cl)||+cl>MAX_BYTES))fail(413,'body_limit');
 if(!req.body)fail(400,'body_required');const r=req.body.getReader(),chunks=[];let size=0;try{while(true){let {done,value}=await r.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await r.cancel();fail(413,'body_limit')}chunks.push(value)}}finally{r.releaseLock()}
 if(!size||(cl!==null&&+cl!==size))fail(400,'body_length');const raw=new Uint8Array(size);let n=0;for(const c of chunks){raw.set(c,n);n+=c.length}let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw)}catch{fail(400,'utf8_invalid')}return {raw,text};
}
function fromHead(h,id,now,repeated){const m=h?.customMetadata;if(!m||!/^[a-f0-9]{64}$/.test(m.sha256||'')||!Number.isFinite(Date.parse(m.receivedAt))||!Number.isFinite(Date.parse(m.retainedUntil)))return null;if(Date.parse(m.retainedUntil)<=now)return null;return {version:2,id,received:true,repeated,receivedAt:m.receivedAt,retainedUntil:m.retainedUntil,sha256:m.sha256}}
export function createHandler({keyResolver,now=()=>Date.now()}={}){return async(req,env)=>{try{
 await authorizeOwner(req,env,{keyResolver,now:now()});
 const path=new URL(req.url).pathname;
 if(req.method==='GET'&&path==='/v2/status')return json(200,{version:2,authenticated:true,enabled:env.UPLOADS_ENABLED==='true'&&!!env.FEEDBACK_BUCKET});
 if(env.UPLOADS_ENABLED!=='true'||!env.FEEDBACK_BUCKET)fail(503,'uploads_disabled');
 const match=path.match(/^\/v2\/feedback\/([0-9a-f-]+)\/receipt$/);
 if(req.method==='GET'&&match&&uuid.test(match[1])){const result=fromHead(await env.FEEDBACK_BUCKET.head('reports/'+match[1]+'.json'),match[1],now(),true);if(!result)fail(404,'not_found');return json(200,result)}
 if(req.method!=='POST'||path!=='/v2/feedback')fail(404,'not_found');
 const {raw,text}=await bounded(req),report=validate(parseUnique(text)),digest=await sha256(raw),receivedAt=new Date(now()).toISOString(),retainedUntil=new Date(now()+30*DAY).toISOString(),key='reports/'+report.id+'.json';
 const stored=await env.FEEDBACK_BUCKET.put(key,raw,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'},customMetadata:{sha256:digest,receivedAt,retainedUntil}});
 if(stored)return json(201,{version:2,id:report.id,received:true,repeated:false,receivedAt,retainedUntil,sha256:digest});
 const result=fromHead(await env.FEEDBACK_BUCKET.head(key),report.id,now(),true);if(result?.sha256===digest)return json(200,result);fail(409,'id_conflict');
 }catch(e){return json(e.status||503,{error:e.code||'temporarily_unavailable'})}}}
export default {fetch:createHandler()};
