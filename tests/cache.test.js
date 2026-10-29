import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {webcrypto} from 'node:crypto';
import {openCache, cachedImage, ensureImages, assemblePdf, fingerprint} from '../site/cache.js';
import {PdfWriter} from '../site/engine.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
class FakeFile {
  constructor(map,name){this.map=map;this.name=name;}
  async getFile(){
    const data=this.map.get(this.name);return {arrayBuffer:async()=>Uint8Array.from(data).buffer,text:async()=>Buffer.from(data).toString('utf8')};
  }
  async createWritable(){
    const chunks=[];let closed=false;
    return {
      write:async data=>{chunks.push(Buffer.from(data));},
      close:async()=>{this.map.set(this.name,Buffer.concat(chunks));closed=true;},
      abort:async()=>{closed=true;},
    };
  }
}
class FakeDir {
  constructor(){this.dirs=new Map();this.files=new Map();}
  async getDirectoryHandle(name,opts={}){
    if(!this.dirs.has(name)){
      if(!opts.create){const e=new Error('No directory');e.name='NotFoundError';throw e;}
      this.dirs.set(name,new FakeDir());
    }return this.dirs.get(name);
  }
  async getFileHandle(name,opts={}){
    if(!this.files.has(name)&&!opts.create){const e=new Error('No file');e.name='NotFoundError';throw e;}
    if(!this.files.has(name))this.files.set(name,Buffer.alloc(0));
    return new FakeFile(this.files,name);
  }
  async *keys(){for(const k of this.files.keys())yield k;}
}
const jpeg=Uint8Array.from(await fs.readFile(fileURLToPath(new URL('./fixture.jpg',import.meta.url))));
const mkPrepared=(n)=>({ark:'btv1b10874323q',pages:Array.from({length:n},(_,i)=>[`https://gallica.bnf.fr/iiif/ark:/12148/btv1b10874323q/f${i+1}/full/full/0/native.jpg`])});

test('recupero delle immagini salvate dopo un errore alla pagina 2',async()=>{
  const prepared=mkPrepared(3), parent=new FakeDir();
  const folder=await openCache(parent,prepared);
  let calls=[];
  await assert.rejects(ensureImages(folder,prepared,async (urls,i)=>{
    calls.push(i);if(i===1)throw new Error('temporaneo');return jpeg;
  },()=>{}),/temporaneo/);
  assert.deepEqual(calls,[0,1]);
  assert.deepEqual(new Uint8Array(await cachedImage(folder,0)),jpeg);
  calls=[];
  const recovered=await openCache(parent,prepared);
  const stats=await ensureImages(recovered,prepared,async (urls,i)=>{calls.push(i);return jpeg;},()=>{});
  assert.deepEqual(calls,[1,2]);
  assert.deepEqual(stats,{reused:1,downloaded:2});
  const filename=await assemblePdf(recovered,prepared,PdfWriter,()=>{});
  assert.equal(filename,'Gallica_btv1b10874323q_originale.pdf');
  const pdf=recovered.files.get(filename);
  assert.match(pdf.toString('latin1'),/\/Count 3/);
  assert.match(pdf.toString('latin1'),/\/Filter \/DCTDecode/);
  await fs.writeFile(path.join(os.tmpdir(),'gallica_test_resumed.pdf'),pdf);
});

test('cartella non può mescolare manifest diversi',async()=>{
 const parent=new FakeDir();await openCache(parent,mkPrepared(3));
 await assert.rejects(openCache(parent,mkPrepared(2)),/versione diversa/);
});

test('il fingerprint è stabile',async()=>{
 const a=await fingerprint(mkPrepared(2)), b=await fingerprint(mkPrepared(2));
 assert.equal(a,b);assert.equal(a.length,64);
});
