(() => {
  'use strict';

  const KEY = 'wpm.v1';       // settings and position (small; written often)
  const DOC = 'wpm.doc';      // { text, title, chapters } (large; written only when the text changes)
  const SIZES = [14, 16, 18, 20, 22, 25, 28, 32, 36, 42, 48];
  const THEMES = ['auto', 'light', 'dark'];
  const SECTION = 4000;       // guide mode shows one chapter, or about this many words, at a time
  const SAMPLE = `Welcome to WPM Reader. Paste anything you want to read, pick a speed, and press play. The highlight moves through the text at exactly that pace, so your eyes have somewhere to be and stop drifting back over lines you have already read.

Guide mode keeps the whole page in view and walks a highlight across it. Flash mode shows one chunk at a time in the centre of the screen, with a single letter marked to rest your eyes on, which is the fastest way to read once you are used to it.

Raise the chunk size to take in two or three words at once. Turn on pausing at punctuation to linger a little at commas and full stops. Click any word, or the progress bar at the bottom, to jump there. Open an EPUB or PDF to read a whole book, a chapter at a time. Your text, your place in it and your settings are saved on this device, so you can close the page and pick up where you left off.`;
  const $ = (id) => document.getElementById(id);

  // ---------- state ----------
  // state: { pos, wpm, chunk, size, mode, pauses, theme } — pos is the index of the first highlighted word.
  let state = load();
  let doc = loadDoc();
  let words = [];        // [{ w, p }] — the word and the index of its paragraph
  let bounds = [0];      // first word of each section shown in guide mode
  let win = { a: 0, b: 0 };   // the words currently rendered in guide mode
  let spans = [];        // their elements; word i is spans[i - win.a]
  let playing = false;
  let timer = 0;
  let due = 0;           // when the current chunk ends (performance.now() time)
  let endAt = 0;         // when the whole text ends at this pace, for a countdown that ticks evenly
  let shown = { a: 0, b: 0 };   // highlighted range in older browsers, to update only what changed
  let started = null;    // { at, pos } of the current run, for the "finished" summary
  let lock = null;
  let toastTimer = 0;
  let iconKey = '';

  function load() {
    const d = { pos: 0, wpm: 250, chunk: 1, size: 4, mode: 'guide', pauses: false, theme: 'auto' };
    try { return { ...d, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return d; }
  }
  function loadDoc() {
    try {
      const d = JSON.parse(localStorage.getItem(DOC));
      if (d && typeof d.text === 'string') return { title: '', chapters: [], ...d };
    } catch {}
    // earlier versions kept the text in the settings
    const text = typeof state.text === 'string' ? state.text : SAMPLE;
    delete state.text;
    return { text, title: '', chapters: [] };
  }

  let saveTimer = 0;
  function save(soon) {   // soon: at most once a second, for things that change on every step
    if (soon) { saveTimer ||= setTimeout(save, 1000); return; }
    clearTimeout(saveTimer); saveTimer = 0;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }
  function saveDoc() {
    try { localStorage.setItem(DOC, JSON.stringify(doc)); return true; } catch {
      localStorage.removeItem(DOC);
      return false;
    }
  }

  // ---------- text ----------
  function parse(text) {
    const out = [];
    text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
      .forEach((line, p) => { for (const w of line.split(/\s+/)) out.push({ w, p }); });
    return out;
  }

  function buildText() {
    words = parse(doc.text);
    // sections: each chapter, with long stretches split at a paragraph break
    const starts = new Set(doc.chapters.map((c) => c.i));
    bounds = [0];
    for (let i = 1; i < words.length; i++) {
      if (starts.has(i) || (i - bounds[bounds.length - 1] >= SECTION && words[i].p !== words[i - 1].p)) bounds.push(i);
    }
    win = { a: 0, b: 0 };
    spans = [];
    $('text').textContent = '';
    if (!words.length) $('text').innerHTML = '<p class="meta">Nothing to read yet. Press <kbd>E</kbd> or “Edit text” to paste something, or open a file.</p>';
    state.pos = Math.min(state.pos, words.length);
    buildToc();
  }

  function sectionOf(i) {
    let lo = 0, hi = bounds.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; bounds[m] <= i ? (lo = m) : (hi = m - 1); }
    return { a: bounds[lo], b: bounds[lo + 1] ?? words.length };
  }

  function chapterAt(i) {   // index into doc.chapters, or -1
    let k = -1;
    for (let j = 0; j < doc.chapters.length && doc.chapters[j].i <= i; j++) k = j;
    return k;
  }

  function renderSection(s) {
    win = s;
    spans = [];
    shown = { a: s.a, b: s.a };
    if (ranges) for (const k in ranges) ranges[k].collapse(true);
    const box = $('text');
    box.textContent = '';
    const nav = (label, to) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'more'; b.dataset.seek = to; b.textContent = label;
      box.append(b);
    };
    if (s.a > 0) {
      const prev = sectionOf(s.a - 1).a, k = chapterAt(prev);
      nav(`↑ ${k >= 0 && doc.chapters[k].i === prev ? doc.chapters[k].t : 'Previous part'}`, prev);
    }
    let para = null, last = -1;
    for (let i = s.a; i < s.b; i++) {
      const { w, p } = words[i];
      if (p !== last) { para = document.createElement('p'); box.append(para); last = p; }
      else para.append(' ');
      const el = document.createElement('span');
      el.className = 'w'; el.dataset.i = i; el.textContent = w;
      para.append(el); spans.push(el);
    }
    if (s.b < words.length) {
      const k = chapterAt(s.b);
      nav(`${k >= 0 && doc.chapters[k].i === s.b ? doc.chapters[k].t : 'Next part'} ↓`, s.b);
    }
  }

  function buildToc() {
    const sel = $('toc');
    sel.textContent = '';
    for (const [k, c] of doc.chapters.entries()) sel.add(new Option(c.t, k));
    $('docbar').hidden = !doc.chapters.length && !doc.title;
    sel.hidden = !doc.chapters.length;
    $('docTitle').textContent = doc.title;
    last.delete('tocv');
  }

  const endsSentence = (i) => /[.!?…]["'”’)\]]*$/.test(words[i].w) || words[i + 1]?.p !== words[i].p;
  const endsClause = (i) => /[,;:—–-]["'”’)\]]*$/.test(words[i].w);

  function sentenceStart(i) {
    while (i > 0 && !endsSentence(i - 1)) i--;
    return i;
  }

  // ---------- playback ----------
  // How long a chunk stays up. Punctuation pauses stretch it; the speed shown is the pace between pauses.
  function hold(a) {
    const b = Math.min(a + state.chunk, words.length);
    let ms = (60000 / state.wpm) * (b - a);
    if (state.pauses && b > a) {
      const e = b - 1;
      if (b === words.length || words[b].p !== words[e].p) ms *= 2.2;
      else if (endsSentence(e)) ms *= 1.9;
      else if (endsClause(e)) ms *= 1.4;
    }
    return ms;
  }

  function remaining(a) {   // ms from the start of chunk a to the end, at the current settings
    if (!state.pauses) return (60000 / state.wpm) * (words.length - a);
    let ms = 0;
    for (let i = a; i < words.length; i += state.chunk) ms += hold(i);
    return ms;
  }

  // (re)start timing the chunk at pos from now
  function restartClock() {
    started = { at: Date.now(), pos: state.pos };
    const now = performance.now();
    due = now + hold(state.pos);
    endAt = now + remaining(state.pos);
    schedule();
  }

  function play() {
    if (!words.length) return openEditor();
    if (state.pos >= words.length) state.pos = 0;
    playing = true;
    restartClock();
    wake(true);
    paint(true);
  }

  function pause() {
    playing = false;
    clearTimeout(timer);
    wake(false);
    save();
    paint();
  }

  const toggle = () => (playing ? pause() : play());

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(step, Math.max(0, due - performance.now()));
  }

  function step() {
    if (!playing) return;
    state.pos = Math.min(state.pos + state.chunk, words.length);
    if (state.pos >= words.length) return finish();
    // after a long stall (tab in background, laptop asleep) carry on from now instead of racing to catch up
    if (due < performance.now() - 1000) return restartClock(), paint(true);
    due += hold(state.pos);
    schedule();
    paint(true);
    save(true);
  }

  function finish() {
    const n = state.pos - (started?.pos ?? 0);
    const secs = started ? (Date.now() - started.at) / 1000 : 0;
    pause();
    if (n > 20 && secs > 5) toast(`Finished · ${n.toLocaleString()} words in ${clock(secs)} (${Math.round(n / (secs / 60))} wpm)`);
    else toast('Finished');
  }

  function seek(i, follow = true) {
    state.pos = Math.max(0, Math.min(i, words.length));
    if (playing) {
      if (state.pos >= words.length) return finish();
      restartClock();
    }
    save(true);
    paint(follow);
  }

  function setSpeed(v) {
    state.wpm = Math.max(50, Math.min(1000, Math.round(v)));
    if (playing) restartClock();
    save(true);
    paint();
  }

  function setChunk(v) {
    state.chunk = Math.max(1, Math.min(10, v));
    if (playing) restartClock();
    save(true);
    paint();
  }

  function setSize(v) {
    state.size = Math.max(0, Math.min(SIZES.length - 1, v));
    save(true);
    paint(true);
  }

  async function wake(on) {   // keep the screen awake while reading on a phone
    try {
      if (on && !lock && navigator.wakeLock) lock = await navigator.wakeLock.request('screen');
      if (!on && lock) { await lock.release(); lock = null; }
    } catch { lock = null; }
  }

  // ---------- painting ----------
  // Write to the DOM only when a value actually changed, so a step costs a handful of writes.
  const last = new Map();
  function put(el, key, v, write) {
    const id = el.id + key;
    if (last.get(id) === v) return;
    last.set(id, v);
    write(v);
  }
  const text = (el, v) => put(el, 'text', v, () => { el.textContent = v; });

  // Where supported, the chunk and the read part are two Ranges painted by the browser (CSS Highlight API):
  // moving them changes no elements at all, and the chunk is one joined highlight across its spaces.
  const ranges = 'highlights' in CSS ? { chunk: new Range(), read: new Range() } : null;
  if (ranges) for (const k in ranges) CSS.highlights.set(k, new Highlight(ranges[k]));
  const sp = (i) => spans[i - win.a];
  function mark(range, from, to) {   // cover words [from, to), clipped to what's rendered
    from = Math.max(from, win.a); to = Math.min(to, win.b);
    if (to <= from) return range.collapse(true);
    range.setStart(sp(from).firstChild, 0);
    range.setEnd(sp(to - 1).firstChild, sp(to - 1).firstChild.length);
  }

  function paint(follow) {
    const n = words.length;
    const a = Math.min(state.pos, n), b = Math.min(a + state.chunk, n);
    put(document.body, 'on', playing, (v) => {
      document.body.classList.toggle('on', v);
      $('play').setAttribute('aria-label', v ? 'Pause' : 'Play');
    });
    put(document.documentElement, 'size', state.size, (v) => document.documentElement.style.setProperty('--size', SIZES[v] + 'px'));

    text($('wpm'), String(state.wpm));
    if (document.activeElement !== $('speed')) put($('speed'), 'v', state.wpm, (v) => { $('speed').value = v; });
    text($('chunk'), String(state.chunk));
    text($('size'), String(SIZES[state.size]));
    put($('pauses'), 'c', state.pauses, (v) => { $('pauses').checked = v; });
    put($('theme'), 'mode', state.mode, (m) => {
      for (const el of document.querySelectorAll('[data-mode]')) el.setAttribute('aria-checked', el.dataset.mode === m);
    });
    text($('theme'), state.theme[0].toUpperCase() + state.theme.slice(1));

    const editing = !$('editor').hidden;
    put($('text'), 'h', editing || state.mode !== 'guide', (v) => { $('text').hidden = v; });
    put($('stage'), 'h', editing || state.mode !== 'flash', (v) => { $('stage').hidden = v; });

    if (state.mode === 'guide' && n) {
      const at = Math.min(a, n - 1);
      if (at < win.a || at >= win.b) { renderSection(sectionOf(at)); follow = 'jump'; }
      if (ranges) {
        mark(ranges.chunk, a, b);
        mark(ranges.read, 0, a);
      } else {   // older browsers: toggle classes on just the words whose state changed
        const lo = Math.max(win.a, Math.min(shown.a, a)), hi = Math.min(win.b, Math.max(shown.b, b, shown.a, a));
        for (let i = lo; i < hi; i++) {
          sp(i).classList.toggle('hl', i >= a && i < b);
          sp(i).classList.toggle('read', i < a);
        }
        if (a < shown.a) for (let i = Math.max(a, win.a); i < Math.min(shown.a, win.b); i++) sp(i).classList.remove('read');
        shown = { a, b };
      }
      if (follow && b > a && sp(a)) (playing && follow !== 'jump' ? glideTo(sp(a)) : keepInView(sp(a), follow === 'jump'));
    } else if (state.mode === 'flash') {
      paintFlash(a, b);
    }

    if (doc.chapters.length) put($('toc'), 'v', chapterAt(a), (k) => { $('toc').value = Math.max(0, k); });

    // progress: while playing the bar glides to the end of the current chunk over exactly as long as it's shown
    const pct = n ? (a / n) * 100 : 0;
    const glide = playing ? { to: (b / n) * 100, ms: Math.max(0, due - performance.now()) } : { to: pct, ms: 200 };
    put($('fill'), 'w', glide.to, () => {
      $('fill').style.transitionDuration = glide.ms.toFixed(0) + 'ms';
      $('fill').style.width = glide.to + '%';
    });
    text($('stats'), n ? (a >= n ? `Done · ${n.toLocaleString()} words` : `${Math.floor(pct)}% · ${a.toLocaleString()} / ${n.toLocaleString()}`) : 'No text');
    tickLeft();
    text($('meta'), n ? `${n.toLocaleString()} words · ${clock((n / state.wpm) * 60)} at this speed` : '');
    const title = playing ? `${Math.floor(pct)}% · ${doc.title || 'WPM Reader'}` : (doc.title ? `${doc.title} · WPM Reader` : 'WPM Reader');
    if (document.title !== title) document.title = title;
    paintIcon(playing, pct);
  }

  // Time left counts down once a second against a fixed finish time, rather than jumping with each chunk.
  function tickLeft() {
    const n = words.length;
    if (!n || state.pos >= n) return text($('left'), '');
    const ms = playing ? endAt - performance.now() : remaining(state.pos);
    text($('left'), ` · ${clock(Math.ceil(Math.max(0, ms) / 1000))} left`);
  }
  setInterval(() => { if (playing) tickLeft(); }, 200);

  function paintFlash(a, b) {
    const chunk = words.slice(a, b).map((x) => x.w).join(' ');
    // the focus letter sits a little left of the middle of the first word (or the middle of a longer chunk)
    let f;
    if (b - a <= 1) { const L = chunk.replace(/\W+$/, '').length || chunk.length; f = L <= 1 ? 0 : L <= 5 ? 1 : L <= 9 ? 2 : L <= 13 ? 3 : 4; }
    else f = Math.floor(chunk.length * 0.4);
    $('fl').textContent = chunk.slice(0, f);
    $('fp').textContent = chunk.slice(f, f + 1);
    $('fr').textContent = chunk.slice(f + 1);
    if (!chunk) $('fp').textContent = words.length ? '✓' : '';
    // shrink a long chunk until both halves fit beside the focus letter
    const box = $('fp').parentElement;
    box.style.fontSize = '';
    const fit = Math.min(1, $('fl').clientWidth / ($('fl').scrollWidth || 1), $('fr').clientWidth / ($('fr').scrollWidth || 1));
    if (fit < 1) box.style.fontSize = `calc(var(--size) * ${(2 * fit * 0.97).toFixed(3)})`;
    // the sentence around the current word, small, so you can tell where you are
    if (words.length && a < words.length) {
      const s = sentenceStart(a);
      let e = a; while (e < words.length - 1 && !endsSentence(e)) e++;
      const ctx = words.slice(s, Math.min(e + 1, s + 24)).map((x) => x.w).join(' ');
      $('ctx').textContent = ctx + (e + 1 > s + 24 ? ' …' : '');
    } else $('ctx').textContent = words.length ? 'Press play to read it again' : 'Nothing to read yet';
  }

  // While playing, the line being read is held at a fixed reading line, like a teleprompter: each time the
  // highlight moves to a new line the page glides up by that one line, instead of waiting for the bottom and jumping.
  const READ_AT = 0.4;   // the reading line, as a fraction of the window height
  let glide = null;      // { from, to, t0, ms }
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function glideTo(el) {
    const r = el.getBoundingClientRect();
    const line = r.height || SIZES[state.size] * 1.7;
    const target = window.innerHeight * READ_AT;
    const end = glide ? glide.to : window.scrollY;           // where we're already heading
    const delta = r.top - target - (end - window.scrollY);   // what's still needed after that
    if (Math.abs(delta) < line * 0.5) return;                // same line: nothing to do
    const to = Math.max(0, Math.min(end + delta, document.documentElement.scrollHeight - window.innerHeight));
    // a one-line glide is gentler than a snap, so it stays on even with reduced motion; only big moves snap
    if (Math.abs(to - window.scrollY) > window.innerHeight * (reduced() ? 0.2 : 1)) { glide = null; window.scrollTo(0, to); return; }
    // take about as long as a couple of chunks, so the motion runs into the next one rather than snapping
    glide = { from: window.scrollY, to, t0: performance.now(), ms: Math.max(350, Math.min(900, hold(state.pos) * 2)) };
    requestAnimationFrame(glideFrame);
  }

  function glideFrame(now) {
    if (!glide) return;
    const k = Math.min(1, (now - glide.t0) / glide.ms);
    const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;   // ease in and out
    window.scrollTo(0, glide.from + (glide.to - glide.from) * ease);
    if (k < 1) requestAnimationFrame(glideFrame); else glide = null;
  }
  // scrolling by hand takes over until the next line change
  for (const ev of ['wheel', 'touchstart', 'keydown']) {
    window.addEventListener(ev, (e) => { if (ev !== 'keydown' || /^(Page|Home|End)/.test(e.key)) glide = null; }, { passive: true });
  }

  // When paused, or after a jump, just make sure the highlight is on screen.
  function keepInView(el, instant) {
    glide = null;
    const r = el.getBoundingClientRect();
    const top = window.innerHeight * 0.15, bottom = window.innerHeight - 110 - window.innerHeight * 0.1;
    if (!instant && r.top >= top && r.bottom <= bottom) return;
    window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * READ_AT, behavior: instant || reduced() ? 'auto' : 'smooth' });
  }

  function paintIcon(on, pct) {   // the tab icon fills up as you read
    const key = on ? Math.floor(pct / 5) : 'off';
    if (key === iconKey) return;
    iconKey = key;
    if (!on) { $('favicon').href = 'icon.svg'; return; }
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#0c0d10';
    g.beginPath(); g.roundRect(0, 0, 64, 64, 14); g.fill();
    g.lineWidth = 7; g.lineCap = 'round';
    g.strokeStyle = '#2a2d36';
    g.beginPath(); g.arc(32, 32, 19, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#4ade80';
    g.beginPath(); g.arc(32, 32, 19, -Math.PI / 2, -Math.PI / 2 + Math.max(0.05, pct / 100) * Math.PI * 2); g.stroke();
    $('favicon').href = c.toDataURL();
  }

  function clock(secs) {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function toast(msg, stay) {
    clearTimeout(toastTimer);
    $('toastText').textContent = msg;
    $('toast').hidden = false;
    if (!stay) toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
  }

  // ---------- editing and files ----------
  function openEditor() {
    if (playing) pause();
    $('src').value = doc.text;
    $('editor').hidden = false;
    paint();
    srcMeta();
    $('src').focus();
  }

  function closeEditor() {
    if ($('editor').hidden) return;
    const v = $('src').value;
    $('editor').hidden = true;
    if (v !== doc.text) setDoc({ text: v, title: '', chapters: [] });   // edited text no longer matches the chapters
    else paint(true);
  }

  function setDoc(d, msg) {
    if (playing) pause();
    doc = { title: '', chapters: [], ...d };
    state.pos = 0;
    buildText();
    const kept = saveDoc();
    save();
    window.scrollTo({ top: 0 });
    paint();
    if (!kept) toast('This is too long to keep on this device, so it won’t be here after you close the page.');
    else if (msg) toast(msg);
  }

  function srcMeta() {
    const n = parse($('src').value).length;
    $('srcMeta').textContent = n ? `${n.toLocaleString()} words · ${clock((n / state.wpm) * 60)} at ${state.wpm} wpm` : '';
  }

  async function openFile(f) {
    if (!f) return;
    $('editor').hidden = true;
    const kind = /\.epub$/i.test(f.name) || f.type === 'application/epub+zip' ? 'epub'
      : /\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? 'pdf'
      : /^text\/|json|xml|markdown/.test(f.type) || /\.(txt|md|markdown|text|csv|html?)$/i.test(f.name) ? 'text' : null;
    if (!kind) return toast('Open a text, EPUB or PDF file');
    if (playing) pause();
    try {
      if (kind === 'text') {
        let t = await f.text();
        if (/\.html?$/i.test(f.name) || f.type === 'text/html') t = new DOMParser().parseFromString(t, 'text/html').body.innerText;
        return setDoc({ text: t, title: f.name.replace(/\.[^.]+$/, '') }, `Opened ${f.name}`);
      }
      toast(`Opening ${f.name}…`, true);
      const d = await window.WPMFormats[kind](f, (m) => toast(m, true));
      const n = parse(d.text).length;
      setDoc(d, `Opened ${d.title} · ${n.toLocaleString()} words${d.chapters.length ? ` · ${d.chapters.length} chapters` : ''}`);
    } catch (err) {
      toast(err?.message || `Couldn’t open ${f.name}`);
    }
  }

  // ---------- wiring ----------
  $('play').addEventListener('click', toggle);
  $('restart').addEventListener('click', () => seek(0));
  $('speed').addEventListener('input', (ev) => setSpeed(Number(ev.target.value)));
  $('pauses').addEventListener('change', (ev) => { state.pauses = ev.target.checked; if (playing) restartClock(); save(); paint(); });
  $('edit').addEventListener('click', openEditor);
  $('open').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (ev) => { openFile(ev.target.files[0]); ev.target.value = ''; });
  $('done').addEventListener('click', closeEditor);
  $('clear').addEventListener('click', () => { $('src').value = ''; srcMeta(); $('src').focus(); });
  $('src').addEventListener('input', srcMeta);
  $('stage').addEventListener('click', toggle);
  $('toc').addEventListener('change', (ev) => { seek(doc.chapters[ev.target.value].i); ev.target.blur(); });

  for (const b of document.querySelectorAll('[data-step]')) {
    b.addEventListener('click', () => {
      const d = Number(b.dataset.d);
      b.dataset.step === 'chunk' ? setChunk(state.chunk + d) : setSize(state.size + d);
    });
  }
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  }
  function setMode(m) {
    state.mode = m;
    shown = { a: win.a, b: win.b };   // repaint every rendered word when coming back to the text
    save();
    paint(true);
  }
  $('theme').addEventListener('click', () => {
    state.theme = THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length];
    if (state.theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = state.theme;
    save(); paint();
  });

  $('text').addEventListener('click', (ev) => {
    const more = ev.target.closest('[data-seek]');
    if (more) { seek(Number(more.dataset.seek)); window.scrollTo({ top: $('text').offsetTop - 16 }); return; }
    const w = ev.target.closest('.w');
    if (w && !getSelection().toString()) seek(Number(w.dataset.i), false);
  });

  // the progress bar seeks; dragging scrubs
  const scrub = (ev) => {
    const r = $('track').getBoundingClientRect();
    seek(Math.round(((ev.clientX - r.left) / r.width) * words.length));
  };
  $('track').addEventListener('pointerdown', (ev) => {
    $('track').setPointerCapture(ev.pointerId);
    scrub(ev);
    const move = (e) => scrub(e);
    $('track').addEventListener('pointermove', move);
    $('track').addEventListener('pointerup', () => $('track').removeEventListener('pointermove', move), { once: true });
  });

  // mouse clicks shouldn't leave focus on a button, or Space would press it again instead of play/pause
  document.addEventListener('click', (ev) => { if (ev.detail > 0) ev.target.closest('button')?.blur(); });

  document.addEventListener('keydown', (ev) => {
    const t = ev.target instanceof Element ? ev.target : document.body;
    if (t.matches('textarea')) {
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); closeEditor(); }
      return;
    }
    if (t.matches('select')) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (t.matches('button') && (ev.key === ' ' || ev.key === 'Enter')) return;
    const k = ev.key;
    const fine = ev.shiftKey ? 1 : 10;
    const act = {
      ' ': toggle,
      ArrowLeft: () => setSpeed(state.wpm - fine),
      ArrowRight: () => setSpeed(state.wpm + fine),
      ArrowUp: () => setChunk(state.chunk + 1),
      ArrowDown: () => setChunk(state.chunk - 1),
      '[': () => { let s = sentenceStart(Math.min(state.pos, words.length - 1)); if (state.pos - s < state.chunk + 1) s = sentenceStart(Math.max(0, s - 1)); seek(s); },
      ']': () => { let e = state.pos; while (e < words.length && !endsSentence(e)) e++; seek(e + 1); },
      r: () => seek(0),
      f: () => setMode(state.mode === 'guide' ? 'flash' : 'guide'),
      e: openEditor,
      o: () => $('file').click(),
      ',': () => setSize(state.size - 1), '<': () => setSize(state.size - 1),
      '.': () => setSize(state.size + 1), '>': () => setSize(state.size + 1),
    }[k.length === 1 ? k.toLowerCase() : k];
    if (!act || (t.matches('input[type=range]') && k.startsWith('Arrow'))) return;
    ev.preventDefault();
    act();
  });

  // drop a file anywhere
  let dragDepth = 0;
  const hasFile = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (ev) => { if (hasFile(ev)) { dragDepth++; $('drop').hidden = false; } });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  document.addEventListener('dragover', (ev) => { if (hasFile(ev)) ev.preventDefault(); });
  document.addEventListener('drop', (ev) => {
    if (!hasFile(ev)) return;
    ev.preventDefault();
    dragDepth = 0; $('drop').hidden = true;
    openFile(ev.dataTransfer.files[0]);
  });

  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); installEvent = ev; $('install').hidden = false; });
  $('install').addEventListener('click', () => { installEvent?.prompt(); $('install').hidden = true; });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    else if (playing) wake(true);   // the lock is dropped whenever the page is hidden
  });

  // another tab changed the text or settings
  window.addEventListener('storage', (ev) => {
    if ((ev.key !== KEY && ev.key !== DOC) || playing) return;
    state = load();
    if (ev.key === DOC) { doc = loadDoc(); buildText(); }
    paint();
  });

  // Shared to the installed app, or opened as ?text=…: read that.
  const q = new URLSearchParams(location.search);
  const shared = [q.get('text'), q.get('url')].filter(Boolean).join('\n\n');
  if (location.search) history.replaceState(null, '', location.pathname);

  if (shared) { doc = { text: shared, title: q.get('title') || '', chapters: [] }; state.pos = 0; saveDoc(); save(); }
  else if (!localStorage.getItem(DOC)) { saveDoc(); save(); }   // move text saved by an earlier version
  buildText();
  if (state.theme !== 'auto') document.documentElement.dataset.theme = state.theme;
  paint(state.pos > 0);   // reopen where you left off

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
