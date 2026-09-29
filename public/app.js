const form = document.querySelector('#energy-form');
const status = document.querySelector('#status');
const button = form.querySelector('button');
const results = document.querySelector('#results');
const label = document.querySelector('#button-label');
const localDate = new Date();
const today = `${localDate.getFullYear()}-${String(localDate.getMonth()+1).padStart(2,'0')}-${String(localDate.getDate()).padStart(2,'0')}`;
form.elements.birthDate.max = today;
const deviceZone=Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const zones=[...new Set([deviceZone,'UTC',...(Intl.supportedValuesOf?Intl.supportedValuesOf('timeZone'):['Asia/Kuala_Lumpur','Asia/Shanghai','Asia/Singapore','America/New_York','Europe/London'])])];
form.elements.timeZone.replaceChildren(...zones.map(zone=>{const option=document.createElement('option');option.value=zone;option.textContent=zone.replaceAll('_',' ');option.selected=zone===deviceZone;return option;}));
const outfitPhoto=document.querySelector('#outfit-photo');
const imageStatus=document.querySelector('#image-status');
const retryImage=document.querySelector('#retry-image');
let lastImageRequest=null;
outfitPhoto.addEventListener('error',()=>{outfitPhoto.hidden=true;imageStatus.textContent='The image could not be loaded. Retry to retrieve the saved image.';retryImage.hidden=false;});
outfitPhoto.addEventListener('load',()=>{outfitPhoto.hidden=false;imageStatus.textContent='';});
const phaseNames=['New Moon','Waxing Crescent','First Quarter','Waxing Gibbous','Full Moon','Waning Gibbous','Last Quarter','Waning Crescent'];
const phaseMessages=['A quiet beginning: choose simple layers and make room for a fresh intention.','Let a small new idea guide a fresh detail in your outfit.','Build momentum with confident shapes and a clear intention.','Refine your look and give the details a little extra care.','Celebrate your presence with luminous textures and an expressive finishing touch.','Soften your pace with comfortable layers and thoughtful details.','Simplify your look and make space for what matters today.','Rest and reset with gentle textures and an easy silhouette.'];
function updateMoon(){
 const parts=new Intl.DateTimeFormat('en',{timeZone:form.elements.timeZone.value,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const get=t=>parts.find(p=>p.type===t).value;
 const date=`${get('year')}-${get('month')}-${get('day')}`;
 const age=(((new Date(date+'T12:00:00Z').getTime()-Date.UTC(2000,0,6,18,14))/86400000)%29.530588853+29.530588853)%29.530588853;
 const phase=age/29.530588853,index=Math.floor(phase*8+.5)%8;
 document.querySelector('#moon-heading').textContent=phaseNames[index];
 document.querySelector('#moon-description').textContent=phaseMessages[index];
 const canvas=document.querySelector('#live-moon'),ctx=canvas.getContext('2d'),pixels=ctx.createImageData(240,240);
 const angle=phase*2*Math.PI,lx=Math.sin(angle),lz=-Math.cos(angle);
 for(let y=0;y<240;y++)for(let x=0;x<240;x++){
  const nx=(x-119.5)/116,ny=(y-119.5)/116,r=nx*nx+ny*ny;if(r>1)continue;
  const nz=Math.sqrt(1-r),light=Math.max(0,nx*lx+nz*lz),shade=.065+.935*Math.sqrt(light);
  const texture=.91+.045*Math.sin(x*.16)*Math.cos(y*.11)+.035*Math.sin(x*.07+y*.09);
  const i=(y*240+x)*4;pixels.data[i]=255*shade*texture;pixels.data[i+1]=219*shade*texture;pixels.data[i+2]=185*shade*texture;pixels.data[i+3]=Math.min(255,(1-r)*16000);
 }
 ctx.putImageData(pixels,0,0);canvas.setAttribute('aria-label',phaseNames[index]+' · '+date);
}
updateMoon();form.elements.timeZone.addEventListener('change',updateMoon);setInterval(updateMoon,60000);
async function loadOutfitImage(request){
 retryImage.hidden=true;retryImage.disabled=true;outfitPhoto.hidden=true;
 imageStatus.textContent='Creating an image of your recommended outfit…';
 try{
  for(let attempt=0;attempt<32;attempt++){
   const response=await fetch('/api/outfit-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,pollOnly:attempt>0}),signal:AbortSignal.timeout(110000)});
   const payload=await response.json();
   if(response.status===202){imageStatus.textContent='Your outfit image is still being prepared…';await new Promise(resolve=>setTimeout(resolve,4000));continue;}
   if(!response.ok)throw new Error(payload.error||'Image generation failed.');
   if(!/^\/api\/outfit-image\?id=[a-f0-9]{64}$/.test(payload.url))throw new Error('Invalid image response.');
   outfitPhoto.alt=payload.alt;outfitPhoto.src=payload.url;outfitPhoto.hidden=false;imageStatus.textContent='Loading your saved outfit image…';return;
  }
  throw new Error('Your image is taking longer than expected. Retry in a few minutes.');
 }catch(error){imageStatus.textContent=error.name==='TimeoutError'?'Image generation timed out. Retry in a few minutes.':error.message;retryImage.hidden=false;}
 finally{retryImage.disabled=false;}
}
retryImage.addEventListener('click',async()=>{if(lastImageRequest){button.disabled=true;try{await loadOutfitImage(lastImageRequest);}finally{button.disabled=false;}}});
function setText(id, text) { document.getElementById(id).textContent = text; }
function setList(id, items) {
 document.getElementById(id).replaceChildren(...items.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
}
form.addEventListener('submit', async event => {
 event.preventDefault();
 if (!form.reportValidity()) return;
 if (location.protocol === 'file:') { status.textContent = 'Open this site through Vercel or the local preview server to generate your reading.'; return; }
 const data = Object.fromEntries(new FormData(form));
 button.disabled = true;
 results.setAttribute('aria-busy','true');
 label.textContent = 'Finding your moonlight…';
 status.className = '';
 status.textContent = 'Your reading is on its way. This may take up to two minutes.';
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 115000);
 try {
  const response = await fetch('/api/generate', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Your reading could not be generated. Please try again.');
  const r = payload.reading;
  if (!r || !Array.isArray(r.do) || !Array.isArray(r.avoid)) throw new Error('The reading was incomplete. Please try again.');
  updateMoon();
  for (const [id,key] of Object.entries({'daily-energy':'dailyEnergy','power-color':'powerColor','avoid-color':'avoidColor','best-outfit':'bestOutfit','best-scent':'bestScent','best-crystal':'bestCrystal','best-time':'bestTime','affirmation':'affirmation'})) setText(id,r[key]);
  document.querySelector('#energy-fill').style.width = `${r.dailyEnergy}%`;
  setList('do-list',r.do); setList('avoid-list',r.avoid);
  setText('result-label',`${data.name.trim()}’s moon outfit`);
  setText('reading-date',`${payload.date} · ${payload.timeZone.replaceAll('_',' ')}`);
  status.textContent = 'Your outfit for today is ready. Same details, same daily reading.';
  lastImageRequest={profile:data,date:payload.date};
  results.setAttribute('aria-busy','false');
  results.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  await loadOutfitImage(lastImageRequest);
 } catch(error) {
  status.className = 'error';
  status.textContent = error.name === 'AbortError' ? 'The reading took too long. Please try again in a moment.' : (error instanceof TypeError ? 'We couldn’t connect. Check your connection and try again.' : error.message);
 } finally {
  clearTimeout(timer); button.disabled=false; results.setAttribute('aria-busy','false'); label.textContent='Generate My Moon Outfit';
 }
});
