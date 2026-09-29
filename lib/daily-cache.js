import {createHash} from 'node:crypto';
// Store the first successful result, shared by every Vercel instance.
// Never silently fall back to process memory or a fresh random result.
export function cacheConfig(env=process.env) {
 const url=env.UPSTASH_REDIS_REST_URL||env.KV_REST_API_URL;
 const token=env.UPSTASH_REDIS_REST_TOKEN||env.KV_REST_API_TOKEN;
 if(!url||!token) throw new Error('Daily storage is not configured. The site owner needs to connect Upstash Redis in Vercel.');
 if(!url.startsWith('https://')) throw new Error('Daily storage requires an HTTPS REST URL.');
 return {url:url.replace(/\/$/,''),token};
}
export function dailyKey(input,date,model='openai/gpt-6-astra') {
 // Explicit ordered fields, Unicode/whitespace/case normalization.
 const profile=['name','birthDate','birthTime','city','style','gender','timeZone'].map(k=>input[k].normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase());
 const digest=createHash('sha256').update(JSON.stringify([model,date,...profile])).digest('hex');
 return `moon:daily:v3:${digest}`;
}
export async function redis(command,config) {
 const response=await fetch(config.url,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(4000)});
 if(!response.ok) throw new Error('Daily storage is temporarily unavailable. Please try again later.');
 const data=await response.json();
 if(data.error) throw new Error('Daily storage could not save the reading. Please try again later.');
 return data.result;
}
export async function readDaily(key,config) {
 const value=await redis(['GET',key],config);
 if(value===null) return null;
 return JSON.parse(value);
}
export async function saveFirstDaily(key,payload,config) {
 const saved=await redis(['SET',key,JSON.stringify(payload),'NX','EX',259200],config);
 if(saved==='OK') return payload;
 // If concurrent requests generated different text, everyone gets the winner.
 const winner=await readDaily(key,config);
 if(!winner) throw new Error('Daily storage is busy. Please retry.');
 return winner;
}
