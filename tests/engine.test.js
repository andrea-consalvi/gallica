import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getArk,manifestUrl,readManifest,jpegDimensions,PdfWriter} from '../site/engine.js';

const ark='btv1b10874323q';
test('riconosce i link pagina, view3if, manifest e frammento',()=>{
 for(const url of [
   `https://gallica.bnf.fr/ark:/12148/${ark}/f36.item#`,
   `https://gallica.bnf.fr/view3if/ga/ark:/12148/${ark}`,
   `https://gallica.bnf.fr/iiif/ark:/12148/${ark}/manifest.json`,
 ]){assert.equal(getArk(url),ark);assert.equal(manifestUrl(url),`https://gallica.bnf.fr/iiif/ark:/12148/${ark}/manifest.json`);}
});
test('legge manifest IIIF v2 e preserva ordine',()=>{
 const m={'@id':manifestUrl(`https://gallica.bnf.fr/ark:/12148/${ark}`),label:'Latin 346',sequences:[{canvases:[
  {images:[{resource:{'@id':`https://gallica.bnf.fr/iiif/ark:/12148/${ark}/f7/full/800,/0/native.jpg`,service:{'@id':`https://gallica.bnf.fr/iiif/ark:/12148/${ark}/f7`}}}]},
  {images:[{resource:{'@id':`https://gallica.bnf.fr/iiif/ark:/12148/${ark}/f8/full/800,/0/native.jpg`}}]}
 ]}]};
 const result=readManifest(m);assert.equal(result.pages.length,2);
 assert.match(result.pages[0][0],/\/f7\/full\/full\/0\/native\.jpg$/);
 assert.match(result.pages[1][0],/\/f8\/full\/full\/0\/native\.jpg$/);
});
test('manifest IIIF v3 e controlli di sicurezza',()=>{
 const m={id:manifestUrl(`https://gallica.bnf.fr/ark:/12148/${ark}`),items:[{items:[{items:[{motivation:'painting',body:{id:`https://gallica.bnf.fr/iiif/ark:/12148/${ark}/f1/full/500,/0/default.jpg`}}]}]}]};
 assert.equal(readManifest(m).pages.length,1);
 assert.throws(()=>readManifest(m,'https://gallica.bnf.fr/ark:/12148/btv1b1111111'),/non corrisponde/);
});
test('PDF streaming mantiene i pixel JPEG',async()=>{
 const jpeg=new Uint8Array(await fs.readFile(fileURLToPath(new URL('./fixture.jpg',import.meta.url))));
 const dim=jpegDimensions(jpeg);assert.ok(dim.w>0&&dim.h>0);
 const chunks=[];
 const writable={async write(data){chunks.push(Buffer.from(data))},async close(){},async abort(){}};
 const writer=new PdfWriter(writable);await writer.start();await writer.addJPEG(jpeg);await writer.addJPEG(jpeg);await writer.finish();
 const pdf=Buffer.concat(chunks);
 const outfile=path.join(os.tmpdir(),'gallica_test_generated.pdf');await fs.writeFile(outfile,pdf);
 assert.equal(writer.count,2);assert.match(pdf.toString('latin1'),/\/Filter \/DCTDecode/);
 assert.match(pdf.toString('latin1'),/\/Count 2/);
});
