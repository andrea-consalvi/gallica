import {getArk, manifestUrl, readManifest, jpegDimensions, PdfWriter} from './engine.js';
import {openCache, ensureImages, assemblePdf} from './cache.js';

const $=id=>document.getElementById(id);
const urlField=$('manuscriptUrl'), fileField=$('manifestFile');
const saveManifest=$('saveManifest'),openManifest=$('openManifest'),testFirst=$('testFirst'),buildPdf=$('buildPdf'),cancel=$('cancel');
const manifestState=$('manifestState'),manifestStatus=$('manifestStatus');
const details=$('details'),docTitle=$('docTitle'),docDetail=$('docDetail');
const downloadState=$('downloadState'),downloadHeading=$('downloadHeading'),downloadStatus=$('downloadStatus'),progress=$('progress');
const checkPageNo=$('checkPageNo'),problemImage=$('problemImage');

let prepared=null, running=false, controller=null, imageLastRequest=-Infinity;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function canceled(){if(controller?.signal.aborted)throw new DOMException('Download annullato','AbortError');}
function manifestMessage(t,kind=''){manifestState.hidden=false;manifestStatus.textContent=t;manifestStatus.className=kind;}
function status(t,kind='',title='Stato del download'){downloadState.hidden=false;downloadHeading.textContent=title;downloadStatus.textContent=t;downloadStatus.className=kind;}
function isCanceled(){return !!controller?.signal.aborted;}
async function wait(ms){const until=Date.now()+ms;while(Date.now()<until){canceled();await sleep(Math.min(400,Math.max(0,until-Date.now())));}}
async function rateLimit(){const rest=imageLastRequest+13000-Date.now();if(rest>0){status(`Rispetto dei limiti BnF: attendo ${Math.ceil(rest/1000)} secondi…`);await wait(rest);}canceled();imageLastRequest=Date.now();}
function setRunning(on){running=on;cancel.hidden=!on;testFirst.disabled=on||!prepared;buildPdf.disabled=on||!prepared;saveManifest.disabled=on;fileField.disabled=on;urlField.disabled=on;checkPageNo.disabled=on||!prepared;}

async function browserGet(url,timeoutMs=180000){
  const timed = new AbortController();
  let expired=false;
  const relay=()=>timed.abort();
  controller?.signal.addEventListener('abort',relay,{once:true});
  if(controller?.signal.aborted)timed.abort();
  const timer=setTimeout(()=>{expired=true;timed.abort();},timeoutMs);
  try{
    const response=await fetch(url,{mode:'cors',credentials:'omit',signal:timed.signal,redirect:'follow',cache:'no-store'});
    if(!response.ok){const e=new Error(`HTTP ${response.status}`);e.code=response.status;e.retryAfter=response.headers.get('Retry-After');throw e;}
    return new Uint8Array(await response.arrayBuffer());
  }catch(e){
    if(isCanceled())throw new DOMException('Download annullato','AbortError');
    if(expired){const timeout=new Error('Connessione scaduta');timeout.code='TIMEOUT';throw timeout;}
    throw e;
  }finally{clearTimeout(timer);controller?.signal.removeEventListener('abort',relay);}
}

function errorReason(err){
  if(err?.code===403) return 'Gallica ha risposto 403: accesso all’immagine rifiutato.';
  if(err?.code===404) return 'L’immagine risulta inesistente (404).';
  if(err?.code===429) return 'Gallica ha limitato le richieste (429).';
  if(err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(err?.message||''))return 'Il browser non riesce a leggere l’immagine (errore di rete o CORS).';
  return err?.message || 'Errore di rete.';
}
function retryable(e){return e?.code===429||e?.code==='TIMEOUT'||e instanceof TypeError ||(typeof e?.code==='number'&&e.code>=500);}
function retryAfterMs(v){
  if(!v)return 0;
  const seconds=Number(v);if(Number.isFinite(seconds))return Math.max(0,seconds*1000);
  const parsed=Date.parse(v);return Number.isFinite(parsed)?Math.max(0,parsed-Date.now()):0;
}
async function downloadJPEG(urls,index,total){
  const waitIntervals=[60000,120000,180000];
  let last=null;
  const failed=[];
  for(let pass=0;pass<=waitIntervals.length;pass++){
    let transient=false;
    for(const [j,url] of urls.entries()){
      await rateLimit();
      status(`Riproduzione ${index+1} di ${total} · tentativo ${pass+1}/${waitIntervals.length+1}${j?' · formato alternativo':''}\nI file già salvati non andranno persi.`);
      try{
        const data=await browserGet(url);
        jpegDimensions(data);
        return data;
      }catch(e){
        if(isCanceled())throw e;
        last=e;failed.push(`${e.code||e.message} — ${url}`);
        // Do not multiply requests if the server explicitly denies access.
        if(e?.code===403){
          throw new Error(`Riproduzione ${index+1}: ${errorReason(e)}\n${url}\nLe pagine già scaricate restano salvate: potrai riprendere.`);
        }
        transient ||= retryable(e);
        if(e?.code===429){break;}
      }
    }
    if(!transient||pass===waitIntervals.length)break;
    const delay=Math.max(waitIntervals[pass],retryAfterMs(last?.retryAfter));
    status(`Problema temporaneo alla riproduzione ${index+1}: ${errorReason(last)}\nRiprovo tra ${Math.ceil(delay/1000)} secondi. Le riproduzioni già scaricate sono al sicuro.`, 'warning','Attesa e nuovo tentativo');
    await wait(delay);
  }
  throw new Error(`Riproduzione ${index+1} non accessibile dopo più tentativi: ${errorReason(last)}\n${failed.slice(-2).join('\n')}\nPuoi riprovare più tardi scegliendo la stessa cartella: il programma riutilizzerà le immagini già scaricate.`);
}

saveManifest.addEventListener('click',async()=>{
  let manifestLink;
  try{manifestLink=manifestUrl(urlField.value.trim());}catch(e){manifestMessage(e.message,'error');return;}
  openManifest.href=manifestLink;openManifest.hidden=false;
  manifestMessage('Recupero del manifest JSON dal browser…');saveManifest.disabled=true;
  try{
    const response=await fetch(manifestLink,{mode:'cors',credentials:'omit',cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const json=await response.json();
    if(!json||typeof json!=='object')throw new Error('Risposta JSON non valida.');
    const blob=new Blob([JSON.stringify(json,null,2)],{type:'application/json'});
    const tmp=URL.createObjectURL(blob);const a=document.createElement('a');
    a.href=tmp;a.download=`Gallica_${getArk(urlField.value)}_manifest.json`;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(tmp),30000);
    manifestMessage('Manifest salvato. Caricalo al punto 2.','success');
  }catch(e){manifestMessage('Download automatico del JSON non riuscito. Usa «Apri manifest in Gallica» e salva il file dal browser (Cmd+S o Ctrl+S).','warning');}
  finally{saveManifest.disabled=false;}
});

fileField.addEventListener('change',async()=>{
  prepared=null;details.hidden=true;testFirst.disabled=true;buildPdf.disabled=true;
  if(!fileField.files?.length)return;
  const file=fileField.files[0];
  if(file.size>25*1024*1024){status('Il manifest supera 25 MB.','error');return;}
  try{
    const json=JSON.parse(await file.text());prepared=readManifest(json,urlField.value.trim());
    docTitle.textContent=prepared.title;
    docDetail.textContent=`Identificativo: ${prepared.ark} · ${prepared.pages.length} riproduzioni · tempo minimo teorico circa ${Math.ceil(prepared.pages.length*13/60)} minuti.`;
    details.hidden=false;testFirst.disabled=false;buildPdf.disabled=false;checkPageNo.disabled=false;checkPageNo.max=prepared.pages.length;
    downloadState.hidden=true;progress.value=0;
  }catch(e){status('Manifest non valido: '+e.message,'error');}
});

cancel.addEventListener('click',()=>controller?.abort());
window.addEventListener('beforeunload',event=>{if(running){event.preventDefault();event.returnValue='';}});

testFirst.addEventListener('click',async()=>{
  if(running||!prepared)return;
  const index=Number(checkPageNo.value)-1;
  if(!Number.isInteger(index)||index<0||index>=prepared.pages.length){status('Numero di riproduzione non valido.','error');return;}
  controller=new AbortController();setRunning(true);progress.value=0;
  try{
    status(`Verifico che il browser possa leggere la riproduzione ${index+1}…`);
    const data=await downloadJPEG(prepared.pages[index],index,prepared.pages.length);
    const {w,h}=jpegDimensions(data);
    status(`Verifica riuscita: JPEG originale ${w} × ${h} pixel, ${(data.byteLength/1024/1024).toFixed(2)} MB.`, 'success','Immagine accessibile');
  }catch(e){status(isCanceled()?'Verifica annullata.':e.message,'error','Verifica non riuscita');}
  finally{setRunning(false);controller=null;}
});

buildPdf.addEventListener('click',async()=>{
  if(running||!prepared)return;
  problemImage.hidden=true;
  if(!window.showDirectoryPicker){status('Per il salvataggio e la ripresa dei download usa Chrome o Edge aggiornati su computer.','error');return;}
  let parent;
  try{parent=await window.showDirectoryPicker({mode:'readwrite',id:'gallica-pdf'});}
  catch(e){if(e.name!=='AbortError')status('Impossibile scegliere la cartella: '+e.message,'error');return;}
  controller=new AbortController();setRunning(true);progress.value=0;
  try{
    const folder=await openCache(parent,prepared);
    status(`Cartella di lavoro: Gallica_${prepared.ark}\nControllo immagini salvate e riprendo dalle mancanti…`);
    const outcome=await ensureImages(folder,prepared,downloadJPEG,evt=>{
      const n=evt.index+1;
      progress.value=Math.round(n*90/prepared.pages.length);
      const p=evt.mode==='fetching'?`Scarico riproduzione ${n} di ${evt.total}…`:`Immagini disponibili: ${evt.reused+evt.downloaded} di ${evt.total} (${evt.reused} già salvate, ${evt.downloaded} nuove).`;
      status(`${p}\nCartella di lavoro: Gallica_${prepared.ark}`,'','Download immagini');
    },canceled);
    status(`Tutte le ${prepared.pages.length} immagini sono sul computer (${outcome.reused} riutilizzate, ${outcome.downloaded} nuove). Creo ora il PDF originale…`,'','Creazione del PDF');
    const filename=await assemblePdf(folder,prepared,PdfWriter,(count,total)=>{
      progress.value=90+Math.round(count*10/total);
      status(`Assemblaggio PDF: ${count} / ${total}. Nessuna ricompressione JPEG.`, '', 'Creazione del PDF');
    },canceled);
    progress.value=100;
    status(`PDF completato!\nFile: Gallica_${prepared.ark}/${filename}\nCartella contenente anche le immagini, conservate per eventuali riutilizzi.`, 'success','PDF completato');
  }catch(e){
    const match=String(e.message||'').match(/Riproduzione (\d+)/);
    if(match&&prepared.pages[Number(match[1])-1]){problemImage.href=prepared.pages[Number(match[1])-1][0];problemImage.hidden=false;}
    status(isCanceled()?'Download annullato. Le immagini già scaricate restano nella cartella: puoi riprendere in seguito.':`Download interrotto: ${e.message}\nLe immagini già salvate non vanno perse. Per riprovare scegli la stessa cartella di destinazione.`, 'error','Download interrompibile e ripristinabile');
  }finally{setRunning(false);controller=null;}
});
