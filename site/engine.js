// Gallica PDF Downloader - codice utilizzabile nel browser e nei test Node.
// Il sito non possiede un backend per scaricare immagini e non aggira blocchi CORS.
const encoder = new TextEncoder();
const GAL = 'gallica.bnf.fr';

export function getArk(value) {
  const m = String(value || '').match(/ark:\/12148\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}
export function manifestUrl(input) {
  const ark = getArk(input);
  if (!ark) throw new Error('Inserisci un collegamento Gallica con un identificativo ark:/12148/…');
  return `https://${GAL}/iiif/ark:/12148/${ark}/manifest.json`;
}
export function readableLabel(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return readableLabel(v[0]);
  if (v && typeof v === 'object') return readableLabel(v.it || v.fr || v.en || Object.values(v)[0]);
  return 'Manoscritto Gallica';
}
export function validatedGallica(url) {
  const u = new URL(String(url));
  if (u.protocol !== 'https:' || u.hostname !== GAL || u.username || u.password) {
    throw new Error('Il manifest contiene un URL immagine esterno a gallica.bnf.fr.');
  }
  return u.href;
}
function getServiceId(obj) {
  const service = Array.isArray(obj?.service) ? obj.service : (obj?.service ? [obj.service] : []);
  for (const s of service) {
    const id = typeof s === 'string' ? s : s?.id || s?.['@id'];
    if (id && /\/iiif\/ark:\/12148\//i.test(id)) return id.replace(/\/info\.json(?:\?.*)?$/i,'').replace(/\/$/, '');
  }
  return null;
}
function imageBase(body, ark, pageNumber) {
  let id = getServiceId(body);
  if (!id) {
    const source = String(body?.id || body?.['@id'] || '');
    const m = source.match(/^(https?:\/\/gallica\.bnf\.fr\/iiif\/ark:\/12148\/[a-z0-9]+\/f\d+)(?:\/|$)/i);
    if (m) id = m[1];
  }
  if (!id) id = `https://${GAL}/iiif/ark:/12148/${ark}/f${pageNumber}`;
  const u = new URL(id);
  if (u.protocol === 'http:' && u.hostname === GAL) u.protocol = 'https:';
  return validatedGallica(u.toString()).replace(/\/$/, '');
}
function urlsFor(body, ark, pageNumber) {
  const base = imageBase(body, ark, pageNumber);
  const urls = [base + '/full/full/0/native.jpg', base + '/full/full/0/default.jpg'];
  const source = String(body?.id || body?.['@id'] || '');
  if (/\/full\/full\/0\/(?:native|default|color)\.jpe?g(?:\?.*)?$/i.test(source)) {
    const u = new URL(source);
    if (u.hostname === GAL && u.protocol === 'http:') u.protocol = 'https:';
    urls.push(u.toString());
  }
  return [...new Set(urls.map(validatedGallica))];
}
export function readManifest(manifest, requestedUrl = '') {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Il file selezionato non è un manifest JSON valido.');
  const id = String(manifest['@id'] || manifest.id || '');
  const title = readableLabel(manifest.label);
  const linkArk = getArk(requestedUrl);
  const ark = getArk(id) || linkArk;
  if (!ark) throw new Error('Impossibile ricavare l’identificativo Gallica dal manifest.');
  if (linkArk && linkArk !== ark) throw new Error('Il manifest caricato non corrisponde al collegamento inserito.');
  const pages = [];
  const canvases = manifest.sequences?.[0]?.canvases;
  if (Array.isArray(canvases)) {
    for (const [i, canvas] of canvases.entries()) {
      const body = canvas.images?.[0]?.resource;
      if (!body) throw new Error(`Nessuna immagine trovata per la riproduzione ${i + 1}.`);
      pages.push(urlsFor(body, ark, i + 1));
    }
  } else if (Array.isArray(manifest.items)) {
    for (const [i, canvas] of manifest.items.entries()) {
      let body = null;
      for (const annPage of canvas.items || []) {
        for (const ann of annPage.items || []) {
          if (!ann.motivation || ann.motivation === 'painting') {
            body = Array.isArray(ann.body) ? ann.body[0] : ann.body;
            if (body) break;
          }
        }
        if (body) break;
      }
      if (!body) throw new Error(`Nessuna immagine trovata per la riproduzione ${i + 1}.`);
      pages.push(urlsFor(body, ark, i + 1));
    }
  }
  if (!pages.length) throw new Error('Il manifest non contiene riproduzioni IIIF riconoscibili.');
  if (pages.length > 3000) throw new Error('Il manoscritto supera il limite di 3000 riproduzioni.');
  return {ark, title, pages};
}
export function jpegDimensions(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216) {
    throw new Error('Il server non ha restituito un JPEG valido.');
  }
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 255) { i++; continue; }
    let marker = bytes[++i];
    while (marker === 255) marker = bytes[++i];
    i++;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 2 > bytes.length) break;
    const n = (bytes[i] << 8) | bytes[i+1];
    if (n < 2 || i + n > bytes.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      const h = (bytes[i+3] << 8) | bytes[i+4];
      const w = (bytes[i+5] << 8) | bytes[i+6];
      const components = bytes[i+7];
      if (!h || !w || ![1,3,4].includes(components)) throw new Error('JPEG con dimensioni o colori non supportati.');
      return {w,h,components};
    }
    i += n;
  }
  throw new Error('Impossibile leggere le dimensioni del JPEG originale.');
}

export class PdfWriter {
  constructor(writable) { this.writable = writable; this.offset = 0; this.offsets = [0]; this.refs = []; this.count = 0; this.closed = false; }
  async write(data) {
    const chunk = typeof data === 'string' ? encoder.encode(data) : data;
    await this.writable.write(chunk);
    this.offset += chunk.byteLength;
  }
  async obj(id, text) { this.offsets[id] = this.offset; await this.write(`${id} 0 obj\n${text}`); }
  async start() { await this.write(encoder.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')); }
  async addJPEG(data) {
    const {w,h,components} = jpegDimensions(data);
    const page = 3 + this.count * 3, content = page + 1, image = page + 2;
    // Formato pagina proporzionale, con un lato non superiore ad A3.
    // I pixel JPEG rimangono tutti nel PDF, indipendentemente dalla scala di visualizzazione.
    const scale = Math.min(842 / w, 1191 / h);
    const pw = +(w * scale).toFixed(3), ph = +(h * scale).toFixed(3);
    const ops = encoder.encode(`q\n${pw} 0 0 ${ph} 0 0 cm\n/Im0 Do\nQ\n`);
    await this.obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>\nendobj\n`);
    await this.obj(content, `<< /Length ${ops.length} >>\nstream\n`);
    await this.write(ops); await this.write('endstream\nendobj\n');
    const color = components === 1 ? '/DeviceGray' : components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    const decode = components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    await this.obj(image, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${color} /BitsPerComponent 8 /Filter /DCTDecode${decode} /Length ${data.length} >>\nstream\n`);
    await this.write(data); await this.write('\nendstream\nendobj\n');
    this.refs.push(`${page} 0 R`);
    this.count++;
  }
  async finish() {
    if (!this.count) throw new Error('Il PDF non contiene immagini.');
    await this.obj(1, '<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    await this.obj(2, `<< /Type /Pages /Kids [${this.refs.join(' ')}] /Count ${this.count} >>\nendobj\n`);
    const xref = this.offset;
    const max = 2 + this.count*3;
    await this.write(`xref\n0 ${max+1}\n0000000000 65535 f \n`);
    for (let i=1; i<=max; i++) await this.write(`${String(this.offsets[i]).padStart(10,'0')} 00000 n \n`);
    await this.write(`trailer\n<< /Size ${max+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    await this.writable.close(); this.closed = true;
  }
  async abort() { if (!this.closed) { try { await this.writable.abort(); } catch (_) {} this.closed = true; } }
}
