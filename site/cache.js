import {jpegDimensions} from './engine.js';

const bytes = new TextEncoder();
const imageName = i => `pagina_${String(i + 1).padStart(4,'0')}.jpg`;
const NAME = 'download-info.json';

async function lookup(folder, name) {
  try { return await folder.getFileHandle(name); }
  catch(e) { if(e.name === 'NotFoundError') return null; throw e; }
}

async function saveBytes(folder, name, data) {
  const handle = await folder.getFileHandle(name,{create:true});
  const writer = await handle.createWritable();
  try { await writer.write(data); await writer.close(); }
  catch(e) { try { await writer.abort(); } catch {} throw e; }
}

export async function fingerprint(prepared) {
  const data = bytes.encode(JSON.stringify([prepared.ark,prepared.pages]));
  const digest = await crypto.subtle.digest('SHA-256',data);
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}

export async function openCache(parent,prepared) {
  const folder = await parent.getDirectoryHandle(`Gallica_${prepared.ark}`,{create:true});
  const current = await fingerprint(prepared);
  const infoHandle = await lookup(folder,NAME);
  if(infoHandle){
    let info;
    try { info = JSON.parse(await (await infoHandle.getFile()).text()); }
    catch { throw new Error('I dati della cartella di lavoro sono danneggiati. Scegli un’altra cartella di destinazione.'); }
    if(info.ark !== prepared.ark || info.fingerprint !== current || info.count !== prepared.pages.length) {
      throw new Error('La cartella contiene immagini di una versione diversa del manifest. Scegli un’altra cartella di destinazione.');
    }
  } else {
    for await (const name of folder.keys()) {
      if(/^pagina_\d+\.jpg$/i.test(name)) throw new Error('La cartella contiene vecchie immagini senza metadati. Per evitare mescolanze scegli un’altra cartella.');
    }
    await saveBytes(folder,NAME,JSON.stringify({ark:prepared.ark,count:prepared.pages.length,fingerprint:current,created:new Date().toISOString()},null,2));
  }
  return folder;
}

export async function cachedImage(folder,index) {
  const handle = await lookup(folder,imageName(index));
  if (!handle) return null;
  try {
    const data = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    jpegDimensions(data);
    return data;
  } catch {
    // A file may have been interrupted or corrupted on disk. Redownload it.
    return null;
  }
}

export async function storeImage(folder,index,jpeg) {
  jpegDimensions(jpeg);
  await saveBytes(folder,imageName(index),jpeg);
}

export async function ensureImages(folder,prepared,download,progress,checkAbort=()=>{}) {
  let reused=0,downloaded=0;
  for (let i=0;i<prepared.pages.length;i++) {
    checkAbort();
    const existing = await cachedImage(folder,i);
    if(existing){reused++;progress({index:i,downloaded,reused,total:prepared.pages.length,mode:'cached'});continue;}
    progress({index:i,downloaded,reused,total:prepared.pages.length,mode:'fetching'});
    const data = await download(prepared.pages[i],i,prepared.pages.length);
    checkAbort();
    await storeImage(folder,i,data);
    downloaded++;
    progress({index:i,downloaded,reused,total:prepared.pages.length,mode:'saved'});
  }
  return {reused,downloaded};
}

export async function assemblePdf(folder,prepared,PdfWriterClass,progress,checkAbort=()=>{}) {
  const filename=`Gallica_${prepared.ark}_originale.pdf`;
  const handle=await folder.getFileHandle(filename,{create:true});
  const writer=new PdfWriterClass(await handle.createWritable());
  try {
    await writer.start();
    for(let i=0;i<prepared.pages.length;i++){
      checkAbort();
      const data=await cachedImage(folder,i);
      if(!data) throw new Error(`La riproduzione ${i+1} non è più disponibile nella cartella di lavoro. Riprova.`);
      await writer.addJPEG(data);
      progress(i+1,prepared.pages.length);
    }
    await writer.finish();
    return filename;
  }catch(e){await writer.abort();throw e;}
}
