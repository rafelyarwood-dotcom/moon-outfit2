import {validateInput} from '../lib/reading.js';
import {cacheConfig,dailyKey,readDaily,redis} from '../lib/daily-cache.js';
import {defaultImageModel,imageId,imagePrompt,readImage,saveImage} from '../lib/outfit-image.js';
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 const fail=(code,error)=>res.status(code).json({error});
 try{
  const config=cacheConfig();
  if(req.method==='GET'){
   const id=new URL(req.url,'https://moon.invalid').searchParams.get('id');
   if(!/^[a-f0-9]{64}$/.test(id||''))return fail(400,'Invalid image.');
   const meta=await readImage(id,config);if(!meta)return fail(404,'Image expired. Generate your daily outfit again.');
   const chunks=[];for(let i=0;i<meta.chunks;i++){const value=await redis(['GET',`moon:image:${id}:${i}`],config);if(!value)return fail(503,'Image temporarily unavailable.');chunks.push(value);}
   res.setHeader('Content-Type',meta.mime);res.setHeader('Cache-Control','private, max-age=3600');
   return res.status(200).end(Buffer.from(chunks.join(''),'base64'));
  }
  if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return fail(405,'Use the outfit form.');}
  if(req.headers['sec-fetch-site']==='cross-site')return fail(403,'Please use the Moon Outfit website.');
  if(!String(req.headers['content-type']||'').includes('application/json'))return fail(415,'Expected JSON.');
  if(Number(req.headers['content-length']||0)>8000)return fail(413,'Form too large.');
  let body,input;
  try{body=typeof req.body==='string'?JSON.parse(req.body):req.body;if(JSON.stringify(body||{}).length>8000)return fail(413,'Form too large.');input=validateInput(body.profile);}catch{return fail(400,'Invalid outfit details.');}
  const parts=new Intl.DateTimeFormat('en',{timeZone:input.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=t=>parts.find(p=>p.type===t).value;
  const date=`${get('year')}-${get('month')}-${get('day')}`;
  if(body.date!==date)return fail(409,'A new day has begun. Generate today’s reading first.');
  const key=dailyKey(input,date,process.env.OPENROUTER_MODEL||'openai/gpt-6-astra');
  const saved=await readDaily(key,config);if(!saved)return fail(409,'Generate your daily reading first.');
  const secret=process.env.OPENROUTER_API_KEY;if(!secret)return fail(503,'The site owner needs to configure OPENROUTER_API_KEY.');
  const model=process.env.OPENROUTER_IMAGE_MODEL||defaultImageModel;
  if(!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:/-]+$/.test(model))return fail(503,'Invalid image model configuration.');
  const id=imageId(key,model,secret),lock=`moon:image:${id}:lock`;
  const ready=()=>res.status(200).json({url:`/api/outfit-image?id=${id}`,alt:saved.reading.bestOutfit});
  if(await readImage(id,config))return ready();
  if(body.pollOnly){res.setHeader('Retry-After','4');return res.status(202).json({pending:true});}
  const locked=await redis(['SET',lock,'busy','NX','EX',150],config);
  if(locked!=='OK'){res.setHeader('Retry-After','4');return res.status(202).json({pending:true});}
  // Re-check after locking: a concurrent request may have just finished.
  if(await readImage(id,config))return ready();
  // One upstream attempt per request; never silently retry paid image calls.
  const upstream=await fetch('https://openrouter.ai/api/v1/images',{
   method:'POST',signal:AbortSignal.timeout(85000),headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json','X-Title':'Moon Outfit'},
   body:JSON.stringify({model,prompt:imagePrompt(saved.reading,input.gender),n:1,resolution:'1K',aspect_ratio:'1:1'})
  });
  if(!upstream.ok){
   const messages={402:'Image generation needs sufficient OpenRouter credits. Check the account balance and key budget.',401:'Image authentication failed. Check OPENROUTER_API_KEY.',403:'The image model is blocked by account or provider permissions.',429:'The image service is busy. Wait a few minutes, then retry the image.'};
   return fail(upstream.status===429?429:503,messages[upstream.status]||'The image service is unavailable. Retry the image later.');
  }
  const data=await upstream.json();await saveImage(id,data.data?.[0],config);
  return ready();
 }catch(error){return fail(503,error.name==='TimeoutError'?'Image generation timed out. Wait a few minutes before retrying.':'The outfit image could not be generated or saved. Your text reading is still available.');}
}
