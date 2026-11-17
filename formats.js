// Turns EPUB and PDF files into { title, text, chapters: [{ t, i }] }, where text has one paragraph per line
// and i is the index of the chapter's first word (counted the same way the reader splits words).
window.WPMFormats = (() => {
  'use strict';

  const countWords = (s) => (s.match(/\S+/g) || []).length;
  const tidy = (s) => s.replace(/\s+/g, ' ').trim();

  // ---------- zip (just enough for EPUB: stored and deflated entries) ----------
  async function unzip(buf) {
    const v = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This file isn’t a valid EPUB (not a zip archive).');
    const entries = new Map();
    let p = v.getUint32(eocd + 16, true);
    for (let k = v.getUint16(eocd + 10, true); k > 0 && v.getUint32(p, true) === 0x02014b50; k--) {
      const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
      entries.set(dec.decode(u8.subarray(p + 46, p + 46 + nameLen)), {
        method: v.getUint16(p + 10, true), size: v.getUint32(p + 20, true), local: v.getUint32(p + 42, true),
      });
      p += 46 + nameLen + extra + comment;
    }
    async function read(name) {
      const e = entries.get(name) ?? entries.get(decodeURIComponent(name));
      if (!e) return null;
      const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
      const raw = u8.subarray(start, start + e.size);
      if (e.method === 0) return raw;
      if (e.method !== 8) throw new Error('This EPUB uses an unsupported compression method.');
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return { entries, read, text: async (name) => { const b = await read(name); return b && dec.decode(b); } };
  }

  // ---------- EPUB ----------
  const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'section', 'article',
    'header', 'footer', 'aside', 'tr', 'dd', 'dt', 'figcaption', 'table', 'ul', 'ol', 'dl', 'figure', 'hr', 'body']);
  const SKIP = new Set(['script', 'style', 'head', 'title', 'svg', 'math', 'rt', 'rp']);

  const parseXml = (s, type = 'application/xhtml+xml') => {
    const d = new DOMParser().parseFromString(s, type);
    return d.getElementsByTagName('parsererror').length ? new DOMParser().parseFromString(s, 'text/html') : d;
  };
  const byTag = (root, name) => [...root.getElementsByTagNameNS('*', name)];
  const resolve = (base, href) => {
    const u = new URL(href, 'http://x/' + base);
    return { path: decodeURIComponent(u.pathname.slice(1)), frag: decodeURIComponent(u.hash.slice(1)) };
  };
  const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);

  async function epub(file) {
    const zip = await unzip(await file.arrayBuffer());
    if (byTag(parseXml((await zip.text('META-INF/encryption.xml')) || '<x/>', 'application/xml'), 'EncryptedData').length) {
      throw new Error('This EPUB is copy-protected (DRM), so its text can’t be read.');
    }
    const container = parseXml(await zip.text('META-INF/container.xml') || '', 'application/xml');
    const opfPath = byTag(container, 'rootfile')[0]?.getAttribute('full-path');
    if (!opfPath) throw new Error('This EPUB is missing its table of contents file.');
    const opf = parseXml(await zip.text(opfPath), 'application/xml');
    const base = dirOf(opfPath);

    const manifest = new Map();
    for (const it of byTag(opf, 'item')) {
      manifest.set(it.getAttribute('id'), {
        path: resolve(base, it.getAttribute('href')).path, type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '',
      });
    }
    const spineEl = byTag(opf, 'spine')[0];
    const spine = byTag(opf, 'itemref').map((r) => manifest.get(r.getAttribute('idref'))).filter((m) => m && /html|xml/.test(m.type));
    const title = tidy(byTag(opf, 'title')[0]?.textContent || '') || file.name.replace(/\.epub$/i, '');

    // walk each chapter file in reading order, one paragraph per block element
    const paras = [], anchors = new Map(), fileStart = new Map(), firstHeading = new Map();
    let n = 0;
    for (const item of spine) {
      const src = await zip.text(item.path);
      if (!src) continue;
      const docEl = parseXml(src);
      const body = docEl.body || byTag(docEl, 'body')[0];
      if (!body) continue;
      fileStart.set(item.path, n);
      let buf = '', pending = [];
      const flush = () => {
        const t = tidy(buf);
        buf = '';
        for (const id of pending) anchors.set(item.path + '#' + id, n);
        pending = [];
        if (t) { paras.push(t); n += countWords(t); }
      };
      const walk = (node) => {
        if (node.nodeType === 3) { buf += node.nodeValue; return; }
        if (node.nodeType !== 1) return;
        const tag = node.localName.toLowerCase();
        if (SKIP.has(tag)) return;
        if (tag === 'br') { flush(); return; }
        if (tag === 'img') { const alt = tidy(node.getAttribute('alt') || ''); if (alt.length > 3) buf += ' ' + alt + ' '; return; }
        const block = BLOCK.has(tag);
        if (block) flush();
        const id = node.getAttribute('id');
        if (id) pending.push(id);
        if (/^h[1-6]$/.test(tag) && !firstHeading.has(item.path)) firstHeading.set(item.path, { t: tidy(node.textContent), i: n });
        for (const c of node.childNodes) walk(c);
        if (block) flush();
      };
      walk(body);
      flush();
    }
    if (!paras.length) throw new Error('No readable text found in this EPUB.');

    // table of contents: EPUB 3 nav document, else the EPUB 2 NCX
    let toc = [];
    const navItem = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
    if (navItem) {
      const nav = parseXml(await zip.text(navItem.path) || '');
      const tocNav = byTag(nav, 'nav').find((x) => /toc/.test(x.getAttribute('epub:type') || x.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || byTag(nav, 'nav')[0];
      if (tocNav) toc = byTag(tocNav, 'a').map((a) => ({ t: tidy(a.textContent), ...resolve(dirOf(navItem.path), a.getAttribute('href') || '') }));
    }
    if (!toc.length) {
      const ncxItem = manifest.get(spineEl?.getAttribute('toc')) || [...manifest.values()].find((m) => /ncx/.test(m.type));
      if (ncxItem) {
        const ncx = parseXml(await zip.text(ncxItem.path) || '', 'application/xml');
        toc = byTag(ncx, 'navPoint').map((np) => ({
          t: tidy(byTag(np, 'text')[0]?.textContent || ''),
          ...resolve(dirOf(ncxItem.path), byTag(np, 'content')[0]?.getAttribute('src') || ''),
        }));
      }
    }
    let chapters = toc
      .map(({ t, path, frag }) => ({ t, i: (frag ? anchors.get(path + '#' + frag) : undefined) ?? fileStart.get(path) }))
      .filter((c) => c.t && c.i != null);
    if (chapters.length < 2) {   // no usable contents: one entry per file, named by its first heading
      chapters = spine.filter((s) => fileStart.has(s.path)).map((s, k) => ({ t: firstHeading.get(s.path)?.t || `Section ${k + 1}`, i: fileStart.get(s.path) }));
    }
    return { title, text: paras.join('\n'), chapters: clean(chapters, n) };
  }

  // sorted, one entry per position, nothing past the end
  function clean(chapters, n) {
    const seen = new Set();
    return chapters.filter((c) => c.i < n).sort((a, b) => a.i - b.i)
      .filter((c) => (seen.has(c.i) ? false : seen.add(c.i))).map((c) => ({ t: c.t.slice(0, 120), i: c.i }));
  }

  // ---------- PDF (via Mozilla's pdf.js, fetched only when a PDF is opened) ----------
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  let pdfjs = null;
  function loadPdfjs() {
    return pdfjs ??= new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = () => { pdfjs = null; fail(new Error('Couldn’t load the PDF reader. Check your connection and try again.')); };
      document.head.append(s);
    });
  }

  const ENDS = /[.!?…:"”’)\]]$/;
  const isPageNumber = (s) => /^(page\s*)?[\divxlc]+(\s*(of|\/)\s*\d+)?$/i.test(s);
  const shape = (s) => s.replace(/\d+/g, '#').toLowerCase();

  async function pdf(file, progress) {
    const lib = await loadPdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;

    // 1. lines per page, from the positioned text runs
    const pages = [];
    for (let k = 1; k <= doc.numPages; k++) {
      if (k % 10 === 1) progress?.(`Reading page ${k} of ${doc.numPages}…`);
      const page = await doc.getPage(k);
      const { items } = await page.getTextContent();
      const lines = [];
      let cur = null;
      for (const it of items) {
        if (!('str' in it)) continue;
        const y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
        if (!cur || Math.abs(cur.y - y) > h * 0.5) { cur = { y, h, s: '' }; lines.push(cur); }
        else if (it.str && !/\s$/.test(cur.s) && !/^\s/.test(it.str)) {
          // runs on one line: add a space only if there's a visible gap (pdf.js gives x and width)
          if (cur.end != null && it.transform[4] - cur.end > h * 0.15) cur.s += ' ';
        }
        cur.s += it.str;
        cur.end = it.transform[4] + (it.width || 0);
        cur.h = Math.max(cur.h, h);
        if (it.hasEOL) cur = null;
      }
      pages.push(lines.map((l) => ({ ...l, s: tidy(l.s) })).filter((l) => l.s));
    }
    if (!pages.some((p) => p.length)) throw new Error('No text found in this PDF. It may be scanned images of pages, which would need OCR.');

    // 2. drop running headers and footers: page numbers, and lines that repeat at the top or bottom of many pages
    const edge = new Map();
    for (const lines of pages) {
      for (const l of new Set([...lines.slice(0, 2), ...lines.slice(-2)])) edge.set(shape(l.s), (edge.get(shape(l.s)) || 0) + 1);
    }
    const repeated = (s) => pages.length >= 4 && (edge.get(shape(s)) || 0) >= Math.max(3, pages.length * 0.3);
    for (const lines of pages) {
      for (const at of [0, 1, -1, -2]) {
        const i = at < 0 ? lines.length + at : at;
        const l = lines[i];
        if (l && (isPageNumber(l.s) || repeated(l.s))) l.drop = true;
      }
    }

    // 3. lines into paragraphs: a bigger than usual gap, or a short line ending a sentence, starts a new one
    const paras = [], pageStart = [];
    let buf = '', n = 0;
    const flush = () => { const t = tidy(buf); buf = ''; if (t) { paras.push(t); n += countWords(t); } };
    pages.forEach((all, k) => {
      const lines = all.filter((l) => !l.drop);
      const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter((g) => g > 0).sort((a, b) => a - b);
      const usual = gaps[Math.floor(gaps.length / 2)] || 14;
      const width = Math.max(...lines.map((l) => l.s.length), 1);
      // a page that starts with a capital or after a finished sentence starts a new paragraph
      if (buf && (ENDS.test(buf.trim()) && /^[A-Z“"‘]/.test(lines[0]?.s || ''))) flush();
      pageStart[k] = n + countWords(buf);
      lines.forEach((l, i) => {
        if (i > 0) {
          const gap = lines[i - 1].y - l.y;
          const prev = lines[i - 1].s;
          if (gap > usual * 1.45 || gap < 0 || (ENDS.test(prev) && prev.length < width * 0.7)) flush();
        }
        // join words hyphenated across lines
        if (/[a-z]-$/.test(buf) && /^[a-z]/.test(l.s)) buf = buf.slice(0, -1) + l.s;
        else buf += (buf ? ' ' : '') + l.s;
      });
    });
    flush();

    // 4. chapters from the PDF's outline (bookmarks), at the first word of their page
    let chapters = [];
    try {
      const outline = (await doc.getOutline()) || [];
      const items = outline.length >= 3 ? outline : outline.flatMap((o) => [o, ...(o.items || [])]);
      for (const o of items) {
        try {
          const dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest;
          if (!dest) continue;
          const page = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0]);
          if (pageStart[page] != null) chapters.push({ t: tidy(o.title || ''), i: pageStart[page] });
        } catch {}
      }
    } catch {}
    const info = await doc.getMetadata().catch(() => null);
    const title = tidy(info?.info?.Title || '') || file.name.replace(/\.pdf$/i, '');
    return { title, text: paras.join('\n'), chapters: clean(chapters.filter((c) => c.t), n) };
  }

  return { epub, pdf };
})();
