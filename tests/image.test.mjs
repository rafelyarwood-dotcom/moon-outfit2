import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/outfit-image.js';
import {dailyKey} from '../lib/daily-cache.js';
import {imageId,defaultImageModel,saveImage} from '../lib/outfit-image.js';
const profile={name:'Luna',gender:'female',birthDate:'1995-06-15',birthTime:'09:30',city:'KL',style:'Elegant',timeZone:'UTC'};
const reading={bestOutfit:'Ivory linen shirt, navy trousers and silver earrings.',powerColor:'Ivory'};
async function call(body,method='POST',url='/api/outfit-image',headers={}){const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(v){this.body=v;return this;},end(v){this.bytes=v;return this;}};await handler({method,url,body,headers:{'content-type':'application/json',...headers}},res);return res;}
test('paid image generation uses cached outfit, locks concurrent calls, persists bytes and isolates errors',async()=>{
 const oldFetch=globalThis.fetch,oldEnv={...process.env},db=new Map();let calls=0,status=200,hold,release;
 const date=new Date().toISOString().slice(0,10),key=dailyKey(profile,date);
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(200000,42)]),b64=bytes.toString('base64');
 try{
  process.env.OPENROUTER_API_KEY='fake-test-key';delete process.env.OPENROUTER_MODEL;delete process.env.OPENROUTER_IMAGE_MODEL;
  process.env.UPSTASH_REDIS_REST_URL='https://mock.cache';process.env.UPSTASH_REDIS_REST_TOKEN='fake-cache';
  globalThis.fetch=async(url,options)=>{
   if(url==='https://mock.cache'){
    const [cmd,k,value,...args]=JSON.parse(options.body);
    if(cmd==='GET')return {ok:true,json:async()=>({result:db.get(k)??null})};
    assert.equal(cmd,'SET');const exists=args.includes('NX')&&db.has(k);if(!exists)db.set(k,value);return {ok:true,json:async()=>({result:exists?null:'OK'})};
   }
   assert.equal(url,'https://openrouter.ai/api/v1/images');calls++;
   const request=JSON.parse(options.body);assert.equal(request.model,defaultImageModel);assert.equal(request.n,1);assert.match(request.prompt,/Ivory linen shirt/);assert.ok(!request.prompt.includes('1995-06-15'));assert.ok(!request.prompt.includes('Luna'));
   if(hold)await hold;
   return {ok:status===200,status,json:async()=>({data:[{b64_json:b64,media_type:'image/png'}]})};
  };
  assert.equal((await call({profile,date})).code,409);assert.equal(calls,0);
  db.set(key,JSON.stringify({reading,date,timeZone:'UTC'}));
  hold=new Promise(resolve=>{release=resolve;});
  const first=call({profile,date});while(calls===0)await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await call({profile,date})).code,202);assert.equal(calls,1);
  release();const result=await first;hold=null;assert.equal(result.code,200);
  const again=await call({profile,date});assert.deepEqual(again.body,result.body);assert.equal(calls,1);
  const image=await call(null,'GET',result.body.url);assert.equal(image.code,200);assert.deepEqual(image.bytes,bytes);assert.equal(image.headers['Content-Type'],'image/png');
  assert.ok(!JSON.stringify(result.body).includes('fake-test-key'));
  assert.equal((await call({profile,date:'2000-01-01'})).code,409);
  assert.equal((await call({profile,date},'POST','/api/outfit-image',{'sec-fetch-site':'cross-site'})).code,403);
  assert.equal((await call(null,'GET','/api/outfit-image?id=bad')).code,400);
  assert.notEqual(imageId(key,'other/model','secret'),imageId(key,defaultImageModel,'secret'));
  for(const code of [401,402,403,429,500]){
   db.clear();db.set(key,JSON.stringify({reading,date}));status=code;
   const failed=await call({profile,date});assert.equal(failed.code,code===429?429:503);assert.ok(failed.body.error);assert.ok(db.has(key));
  }
  db.clear();db.set(key,JSON.stringify({reading,date}));const before=calls;
  assert.equal((await call({profile,date,pollOnly:true})).code,202);assert.equal(calls,before);
  await assert.rejects(saveImage('x',{b64_json:Buffer.from('<svg>bad</svg>').toString('base64')},{url:'https://mock.cache',token:'x'}));
 }finally{globalThis.fetch=oldFetch;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);}
});
