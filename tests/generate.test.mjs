import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/generate.js';
import {validateInput,moonPhase} from '../lib/reading.js';
import {dailyKey,saveFirstDaily} from '../lib/daily-cache.js';
import {boards,attachOutfit} from '../lib/wardrobe.js';
import {access} from 'node:fs/promises';
const input={name:'Luna',gender:'female',birthDate:'1995-06-15',birthTime:'09:30',city:'Kuala Lumpur',style:'Elegant',timeZone:'Asia/Kuala_Lumpur'};
const reading={moonMessage:'Let your style shine.',dailyEnergy:82,avoidColor:'Neon Orange',bestOutfit:'Silver blouse with ivory trousers.',powerColor:'Silver',bestScent:'Jasmine',bestCrystal:'Moonstone',bestTime:'7 PM – 9 PM',do:['Create','Connect','Reflect'],avoid:['Rush','Compare','Overspend'],affirmation:'I shine in my own way.'};
async function call(body=input,method='POST',headers={}){
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(v){this.body=v;return this;}};
 await handler({method,headers:{'content-type':'application/json',...headers},body},res);return res;
}
test('dates, gender, normalized profile and wardrobe assets',async()=>{
 assert.equal(validateInput(input).name,'Luna');
 for(const patch of [{birthDate:'2024-02-31'},{birthTime:'25:00'},{timeZone:'Fake/Zone'},{name:'x'.repeat(61)},{gender:''},{gender:'invalid'}]) assert.throws(()=>validateInput({...input,...patch}));
 assert.equal(moonPhase(new Date('2000-01-06T18:14:00Z')),'New Moon');
 assert.equal(dailyKey(input,'2026-09-29'),dailyKey({...input,name:'  LUNA  ',city:'Kuala   Lumpur'},'2026-09-29'));
 assert.notEqual(dailyKey(input,'2026-09-29'),dailyKey(input,'2026-09-30'));
 assert.notEqual(dailyKey(input,'2026-09-29'),dailyKey({...input,gender:'male'},'2026-09-29'));
 assert.equal(attachOutfit(reading,{...input,gender:'male'}).outfitImage,undefined);
 for(const image of Object.values(boards)) await access(new URL('..'+image,import.meta.url));
});
test('durable daily results, concurrency, gender matching, errors and timezone rollover',async()=>{
 const originalFetch=globalThis.fetch;const OriginalDate=globalThis.Date;
 const keys=['OPENROUTER_API_KEY','OPENROUTER_MODEL','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','KV_REST_API_URL','KV_REST_API_TOKEN'];
 const env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 let instant='2026-09-29T15:59:00Z';
 globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return new OriginalDate(instant).getTime();}};
 const db=new Map();let aiCalls=0;let aiStatus=200;let badContent;let failWrite=false;let sent;
 try{
  keys.forEach(k=>delete process.env[k]);
  assert.equal((await call(input,'GET')).code,405);
  assert.equal((await call(input,'POST',{'sec-fetch-site':'cross-site'})).code,403);
  assert.equal((await call(input,'POST',{'content-type':'text/plain'})).code,415);
  assert.equal((await call({...input,name:''})).code,400);
  assert.equal((await call('{broken')).code,400);
  assert.equal((await call({...input,extra:'x'.repeat(9000)})).code,413);
  assert.equal((await call()).code,503);
  process.env.UPSTASH_REDIS_REST_URL='https://test.upstash.io';process.env.UPSTASH_REDIS_REST_TOKEN='test-cache-token';
  globalThis.fetch=async(url,options)=>{
   if(url==='https://test.upstash.io'){
    const [command,key,value,nx,ex,ttl]=JSON.parse(options.body);
    if(command==='GET')return {ok:true,json:async()=>({result:db.get(key)??null})};
    assert.equal(command,'SET');assert.equal(nx,'NX');assert.equal(ex,'EX');assert.equal(ttl,259200);
    if(failWrite)return {ok:false,status:503};
    const exists=db.has(key);if(!exists)db.set(key,value);
    return {ok:true,json:async()=>({result:exists?null:'OK'})};
   }
   assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');aiCalls++;
   sent=JSON.parse(options.body);
   if(aiStatus!==200)return {ok:false,status:aiStatus};
   const profile=JSON.parse(sent.messages[1].content).profile;
   const bestOutfit=profile.gender==='male'?'Navy blazer, ivory shirt and tailored trousers.':reading.bestOutfit;
   return {ok:true,json:async()=>({choices:[{message:{content:badContent??JSON.stringify({...reading,bestOutfit,dailyEnergy:70+aiCalls})}}]})};
  };
  assert.equal((await call()).code,503); // missing API key, with storage available
  process.env.OPENROUTER_API_KEY='test-ai-key';
  const first=await call();assert.equal(first.code,200);assert.equal(first.body.date,'2026-09-29');assert.equal(first.body.reading.outfitImage,undefined);
  const second=await call({...input,name:' LUNA '});assert.deepEqual(second.body,first.body);assert.equal(aiCalls,1);
  // A fresh module/instance uses the same remote cache, not process memory.
  const cold=(await import('../api/generate.js?cold=1')).default;
  const coldRes={setHeader(){},status(c){this.code=c;return this;},json(v){this.body=v;return this;}};
  await cold({method:'POST',headers:{'content-type':'application/json'},body:input},coldRes);assert.deepEqual(coldRes.body,first.body);assert.equal(aiCalls,1);
  const male=await call({...input,gender:'male'});assert.equal(male.code,200);assert.equal(male.body.reading.outfitImage,undefined);assert.match(male.body.reading.bestOutfit,/blazer/);assert.equal(male.body.reading.outfitImage,undefined);
  const casual=await call({...input,style:'Casual'});assert.equal(casual.body.reading.outfitImage,undefined);
  assert.equal(sent.temperature,undefined);assert.deepEqual(sent.reasoning,{effort:'low'});assert.equal(sent.model,'openai/gpt-6-astra');assert.ok(!JSON.stringify(first.body).includes('test-ai-key'));
  const simultaneous=await Promise.all([call({...input,name:'Concurrent'}),call({...input,name:'Concurrent'})]);assert.equal(simultaneous[0].code,200);assert.deepEqual(simultaneous[0].body,simultaneous[1].body);
  const config={url:'https://test.upstash.io',token:'test-cache-token'};
  const winners=await Promise.all([saveFirstDaily('race',{value:1},config),saveFirstDaily('race',{value:2},config)]);assert.deepEqual(winners[0],winners[1]);
  instant='2026-09-29T16:01:00Z';const tomorrow=await call();assert.equal(tomorrow.body.date,'2026-09-30');assert.notDeepEqual(tomorrow.body,first.body);
  const inUTC=await call({...input,timeZone:'UTC'});assert.equal(inUTC.body.date,'2026-09-29');
  for(const status of [429,401,402,403,503]){aiStatus=status;db.clear();assert.equal((await call()).code,status===429?429:503);}
  aiStatus=200;
  for(const content of ['broken JSON',JSON.stringify({...reading,dailyEnergy:999}),JSON.stringify({...reading,bestOutfit:''})]){db.clear();badContent=content;assert.equal((await call()).code,502);}
  badContent=undefined;db.clear();failWrite=true;assert.equal((await call()).code,503);assert.equal(db.size,0);failWrite=false;
  process.env.OPENROUTER_MODEL='openai/gpt-4.1';assert.equal((await call()).code,200);assert.equal(sent.model,'openai/gpt-4.1');
  process.env.OPENROUTER_MODEL='invalid model';assert.equal((await call()).code,503);
 }finally{globalThis.fetch=originalFetch;globalThis.Date=OriginalDate;for(const k of keys){if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}}
});
