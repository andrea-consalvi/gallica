import {getArk, manifestUrl, readManifest, jpegDimensions, PdfWriter} from './engine.js';

const $ = id => document.getElementById(id);
const urlField=$('manuscriptUrl'), fileField=$('manifestFile');
const saveManifest=$('saveManifest'),openManifest=$('openManifest'),testFirst=$('testFirst'),buildPdf=$('buildPdf'),cancel=$('cancel');
const manifestState=$('manifestState'),manifestStatus=$('manifestStatus');
const details=$('details'),docTitle=$('docTitle'),docDetail=$('docDetail');
const downloadState=$('downloadState'),downloadHeading=$('downloadHeading'),downloadStatus=$('downloadStatus'),progress=$('progress');

let prepared=null, running=false, controller=null, imageLastRequest=-Infinity;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const abortIfNeeded=()=>{if(controller?.signal.aborted)throw new DOMException('Download annullato','AbortError');};
function manifestMessage(t,kind=''){manifestState.hidden=false;manifestStatus.textContent=t;manifestStatus.className=kind;}
function status(t,kind='',title='Stato del download'){downloadState.hidden=false;downloadHeading.textContent=title;downloadStatus.textContent=t;downloadStatus.className=kind;}
function isAbort(e){return e?.name==='AbortError'||controller?.signal.aborted;}
function rateSlotMs(){return 13000;}
async function interruptibleWait(ms){let end=Date.now()+ms;while(Date.now()<end){abortIfNeeded();await sleep(Math.min(400,end-Date.now()));}}
async function rateLimit(){const rest=imageLastRequest+rateSlotMs()-Date.now();if(rest>0){status(`Rispetto del limite Gallica: attendo ${Math.ceil(rest/1000)} secondi prima della prossima richiesta…`);await interruptibleWait(rest);}abortIfNeeded();imageLastRequest=Date.now();}
function setRunning(on){running=on;cancel.hidden=!on;testFirst.disabled=on||!prepared;buildPdf.disabled=on||!prepared;saveManifest.disabled=on;fileField.disabled=on;urlField.disabled=on;}
function timeoutFetch(url,timeout=180000){
  const timed=new AbortController();
  const relay=()=>timed.abort();
  controller?.signal.addEventListener('abort',relay,{once:true});
  const timer=setTimeout(()=>timed.abort(),timeout);
  return fetch(url,{mode:'cors',credentials:'omit',signal:timed.signal,redirect:'follow',cache:'no-store'})
    .finally(()=>{clearTimeout(timer);controller?.signal.removeEventListener('abort',relay);});
}
function usefulFetchError(err,url){
  if(err?.code===403) return `Gallica risponde HTTP 403 alla richiesta dell'immagine. Il sito web non può superare questo blocco.\n${url}`;
  if(err?.code===429) return 'Gallica limita le richieste (HTTP 429); il programma attende prima di riprovare.';
  if(err instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(err?.message||''))
    return 'Il browser non riesce a leggere questa immagine da un sito esterno (possibile blocco CORS o errore di rete). Anche se l’immagine si apre in una scheda, Gallica potrebbe non consentirne la lettura a questa applicazione web. Puoi utilizzare l’estensione Chrome, oppure chiedere un accesso autorizzato alla BnF.';
  return err?.message || 'Errore durante il download dell’immagine.';
}
async function browserGet(url,timeout){
  const r=await timeoutFetch(url,timeout);
  if(!r.ok){const e=new Error(`HTTP ${r.status}`);e.code=r.status;e.retryAfter=r.headers.get('Retry-After');throw e;}
  return new Uint8Array(await r.arrayBuffer());
}
async function downloadJPEG(urls,i,total){
  let last=null,failures=[];
  for(let pass=0;pass<3;pass++){
    let tryAgain=false;
    for(const url of urls){
      await rateLimit();
      status(`Riproduzione ${i+1} di ${total}\nRichiesta originale a Gallica (${pass+1}/3)…`);
      try{
        const data=await browserGet(url);
        jpegDimensions(data);
        return data;
      }catch(err){
        if(isAbort(err)){abortIfNeeded();throw err;}
        last=err;
        failures.push(`${err.code||err.message} — ${url}`);
        if(err.code===429){
          let seconds=parseInt(err.retryAfter||'60',10);if(!Number.isFinite(seconds)||seconds<1)seconds=60;
          const delay=Math.min(180,seconds)*1000;
          status(`Gallica risponde 429: attendo ${Math.ceil(delay/1000)} secondi…`,'warning');
          await interruptibleWait(delay);tryAgain=true;break;
        }
        if(err.code===403||err.code===404||err.code===400)continue;
        // Un errore CORS non è necessariamente risolvibile con altri nomi di file,
        // ma si prova la variante 'default.jpg' una sola volta.
        if(err instanceof TypeError)continue;
        if(err.code && err.code>=500){tryAgain=true;break;}
      }
    }
    if(!tryAgain)break;
    if(pass<2)await interruptibleWait(2000*Math.pow(2,pass));
  }
  throw new Error(`Riproduzione ${i+1} non accessibile. ${usefulFetchError(last,urls[0])}\n${failures.slice(-2).join('\n')}`);
}

saveManifest.addEventListener('click',async()=>{
  let manifestLink;
  try{manifestLink=manifestUrl(urlField.value.trim());}
  catch(e){manifestMessage(e.message,'error');return;}
  openManifest.href=manifestLink;openManifest.hidden=false;
  manifestMessage('Tentativo di recuperare il manifest JSON direttamente dal browser…');
  saveManifest.disabled=true;
  try{
    const r=await fetch(manifestLink,{mode:'cors',credentials:'omit',cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const json=await r.json();
    if(!json||typeof json!=='object')throw new Error('Risposta JSON non valida.');
    const blob=new Blob([JSON.stringify(json,null,2)],{type:'application/json'});
    const objectURL=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=objectURL;anchor.download=`Gallica_${getArk(urlField.value)}_manifest.json`;
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(objectURL),30000);
    manifestMessage('Manifest salvato. Seleziona il file JSON al punto 2.','success');
  }catch(e){
    manifestMessage('Gallica non consente il salvataggio automatico da questo sito (CORS oppure accesso negato). Premi «Apri manifest in Gallica», poi salvalo dal browser con Cmd + S o Ctrl + S. Il manifest rimane quello originale della BnF.','warning');
  }finally{saveManifest.disabled=false;}
});

fileField.addEventListener('change',async()=>{
  prepared=null;details.hidden=true;testFirst.disabled=true;buildPdf.disabled=true;
  if(!fileField.files?.length)return;
  const file=fileField.files[0];
  if(file.size>25*1024*1024){status('Il file supera 25 MB: verifica che sia il manifest corretto.','error');return;}
  try{
    const parsed=JSON.parse(await file.text());
    prepared=readManifest(parsed,urlField.value.trim());
    docTitle.textContent=prepared.title;
    docDetail.textContent=`Identificativo: ${prepared.ark} · ${prepared.pages.length} riproduzioni · tempo minimo teorico circa ${Math.ceil(prepared.pages.length*13/60)} minuti.`;
    details.hidden=false;testFirst.disabled=false;buildPdf.disabled=false;
    downloadState.hidden=true;progress.value=0;
  }catch(e){status('Errore nel manifest: '+e.message,'error');}
});

cancel.addEventListener('click',()=>controller?.abort());
window.addEventListener('beforeunload',event=>{if(running){event.preventDefault();event.returnValue='';}});

async function verify(){
  if(running||!prepared)return;
  controller=new AbortController();setRunning(true);progress.value=0;
  try{
    status('Provo a leggere la prima immagine originale direttamente dal browser…');
    const data=await downloadJPEG(prepared.pages[0],0,prepared.pages.length);
    const {w,h}=jpegDimensions(data);
    status(`Verifica riuscita: JPEG originale ${w} × ${h} pixel, ${(data.byteLength/1024/1024).toFixed(2)} MB.\nOra puoi creare il PDF.`, 'success','Immagine accessibile');
  }catch(e){status(isAbort(e)?'Verifica annullata.':e.message,'error','Immagine non accessibile');}
  finally{setRunning(false);controller=null;}
}
testFirst.addEventListener('click',verify);

buildPdf.addEventListener('click',async()=>{
  if(running||!prepared)return;
  if(!window.showSaveFilePicker){
    status('Questo browser non supporta il salvataggio progressivo dei PDF. Per manoscritti grandi usa Chrome o Edge aggiornati su computer.','error');return;
  }
  // Deve essere chiamato nel gesto utente, prima di qualunque await non necessario.
  let handle;
  try{
    handle=await window.showSaveFilePicker({suggestedName:`Gallica_${prepared.ark}_originale.pdf`,types:[{description:'Documento PDF',accept:{'application/pdf':['.pdf']}}]});
  }catch(e){if(e.name!=='AbortError')status('Impossibile selezionare il file di destinazione: '+e.message,'error');return;}
  controller=new AbortController();setRunning(true);progress.value=0;
  let writer;
  try{
    writer=new PdfWriter(await handle.createWritable());await writer.start();
    for(let i=0;i<prepared.pages.length;i++){
      abortIfNeeded();
      const jpeg=await downloadJPEG(prepared.pages[i],i,prepared.pages.length);
      await writer.addJPEG(jpeg);
      progress.value=Math.round((i+1)*100/prepared.pages.length);
      status(`${i+1} / ${prepared.pages.length} immagini inserite nel PDF (${progress.value}%).\nNessuna ricompressione JPEG.`, '', 'Download in corso');
    }
    await writer.finish();writer=null;
    status(`PDF completo salvato: ${prepared.pages.length} immagini originali.`, 'success','PDF completato');
  }catch(e){
    if(writer)await writer.abort();
    status(isAbort(e)?'Download annullato; il file incompleto non è utilizzabile.':`PDF non completato: ${e.message}`, 'error','Download interrotto');
  }finally{setRunning(false);controller=null;}
});
