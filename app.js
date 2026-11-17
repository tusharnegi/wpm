(() => {
  'use strict';

  const KEY = 'wpm.v1';
  const SIZES = [14, 16, 18, 20, 22, 25, 28, 32, 36, 42, 48];
  const THEMES = ['auto', 'light', 'dark'];
  const SAMPLE = `Welcome to WPM Reader. Paste anything you want to read, pick a speed, and press play. The highlight moves through the text at exactly that pace, so your eyes have somewhere to be and stop drifting back over lines you have already read.

Guide mode keeps the whole page in view and walks a highlight across it. Flash mode shows one chunk at a time in the centre of the screen, with a single letter marked to rest your eyes on, which is the fastest way to read once you are used to it.

Raise the chunk size to take in two or three words at once. Turn on pausing at punctuation to linger a little at commas and full stops. Click any word, or the progress bar at the bottom, to jump there. Your text, your place in it and your settings are saved on this device, so you can close the page and pick up where you left off.`;
  const $ = (id) => document.getElementById(id);

  // ---------- state ----------
  // { text, pos, wpm, chunk, size, mode, pauses, theme } — pos is the index of the first highlighted word.
  let state = load();
  let words = [];        // [{ w, p }] — the word and the index of its paragraph
  let spans = [];        // the word elements in guide mode
  let playing = false;
  let timer = 0;
  let due = 0;           // when the current chunk ends
  let shown = { a: 0, b: 0 };   // highlighted range [a, b) in the text, to update only what changed
  let started = null;    // { at, pos } of the current run, for the "finished" summary
  let lock = null;
  let toastTimer = 0;
  let iconKey = '';

  function load() {
    const d = { text: SAMPLE, pos: 0, wpm: 250, chunk: 1, size: 4, mode: 'guide', pauses: false, theme: 'auto' };
    try { return { ...d, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return d; }
  }
  let saveTimer = 0;
  function save(soon) {
    clearTimeout(saveTimer);
    const write = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
    soon ? (saveTimer = setTimeout(write, 400)) : write();
  }

  // ---------- text ----------
  function parse(text) {
    const out = [];
    text.split(/\n+/).map((l) => l.trim()).filter(Boolean)
      .forEach((line, p) => { for (const w of line.split(/\s+/)) out.push({ w, p }); });
    return out;
  }

  function buildText() {
    words = parse(state.text);
    spans = [];
    const box = $('text');
    box.textContent = '';
    let para = null, last = -1;
    words.forEach(({ w, p }, i) => {
      if (p !== last) { para = document.createElement('p'); box.append(para); last = p; }
      else para.append(' ');
      const s = document.createElement('span');
      s.className = 'w'; s.dataset.i = i; s.textContent = w;
      para.append(s); spans.push(s);
    });
    if (!words.length) box.innerHTML = '<p class="meta">Nothing to read yet. Press <kbd>E</kbd> or “Edit text” to paste something.</p>';
    shown = { a: 0, b: 0 };
    if (ranges) for (const k in ranges) ranges[k].collapse(true);   // they pointed into the old text
    state.pos = Math.min(state.pos, words.length);
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

  function play() {
    if (!words.length) return openEditor();
    if (state.pos >= words.length) state.pos = 0;
    playing = true;
    started = { at: Date.now(), pos: state.pos };
    due = performance.now() + hold(state.pos);
    schedule();
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
    due += hold(state.pos);
    // after a long stall (tab in background, laptop asleep) carry on from now instead of racing to catch up
    if (due < performance.now() - 1000) due = performance.now() + hold(state.pos);
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
      started = { at: Date.now(), pos: state.pos };
      due = performance.now() + hold(state.pos);
      schedule();
    }
    save(true);
    paint(follow);
  }

  function setSpeed(v) {
    state.wpm = Math.max(50, Math.min(1000, Math.round(v)));
    if (playing) { due = performance.now() + hold(state.pos); schedule(); started = { at: Date.now(), pos: state.pos }; }
    save(true);
    paint();
  }

  function setChunk(v) {
    state.chunk = Math.max(1, Math.min(10, v));
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
  function mark(range, from, to) {   // cover words [from, to)
    if (to <= from) return range.collapse(true);
    range.setStart(spans[from].firstChild, 0);
    range.setEnd(spans[to - 1].firstChild, spans[to - 1].firstChild.length);
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

    if (state.mode === 'guide' && spans.length) {
      if (ranges) {
        mark(ranges.chunk, a, b);
        mark(ranges.read, 0, a);
      } else {   // older browsers: toggle classes on just the words whose state changed
        const lo = Math.min(shown.a, a), hi = Math.max(shown.b, b, shown.a, a);
        for (let i = lo; i < hi && i < spans.length; i++) {
          spans[i].classList.toggle('hl', i >= a && i < b);
          spans[i].classList.toggle('read', i < a);
        }
        if (a < shown.a) for (let i = a; i < shown.a; i++) spans[i].classList.remove('read');
        shown = { a, b };
      }
      if (follow && b > a) keepInView(spans[a]);
    } else if (state.mode === 'flash') {
      paintFlash(a, b);
    }

    // progress
    const pct = n ? (a / n) * 100 : 0;
    put($('fill'), 'w', pct, (v) => { $('fill').style.width = v + '%'; });
    const stats = n
      ? (a >= n ? `<b>Done</b> · ${n.toLocaleString()} words` :
        `<b>${Math.floor(pct)}%</b> · ${a.toLocaleString()} / ${n.toLocaleString()} · ${clock(((n - a) / state.wpm) * 60)} left`)
      : 'No text';
    put($('stats'), 'html', stats, (v) => { $('stats').innerHTML = v; });
    text($('meta'), n ? `${n.toLocaleString()} words · ${clock((n / state.wpm) * 60)} at this speed` : '');
    const title = playing ? `${Math.floor(pct)}% · WPM Reader` : 'WPM Reader';
    if (document.title !== title) document.title = title;
    paintIcon(playing, pct);
  }

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

  function keepInView(el) {
    const r = el.getBoundingClientRect();
    const top = window.innerHeight * 0.22, bottom = window.innerHeight - 110 - window.innerHeight * 0.18;
    if (r.top >= top && r.bottom <= bottom) return;
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.35, behavior: smooth ? 'smooth' : 'auto' });
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

  function toast(msg) {
    clearTimeout(toastTimer);
    $('toastText').textContent = msg;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
  }

  // ---------- editing ----------
  function openEditor() {
    if (playing) pause();
    $('src').value = state.text;
    $('editor').hidden = false;
    paint();
    srcMeta();
    $('src').focus();
  }

  function closeEditor() {
    if ($('editor').hidden) return;
    const v = $('src').value;
    $('editor').hidden = true;
    if (v !== state.text) setText(v);
    else paint(true);
  }

  function setText(text, msg) {
    if (playing) pause();
    state.text = text;
    state.pos = 0;
    buildText();
    save();
    window.scrollTo({ top: 0 });
    paint();
    if (msg) toast(msg);
  }

  function srcMeta() {
    const n = parse($('src').value).length;
    $('srcMeta').textContent = n ? `${n.toLocaleString()} words · ${clock((n / state.wpm) * 60)} at ${state.wpm} wpm` : '';
  }

  // ---------- wiring ----------
  $('play').addEventListener('click', toggle);
  $('restart').addEventListener('click', () => seek(0));
  $('speed').addEventListener('input', (ev) => setSpeed(Number(ev.target.value)));
  $('pauses').addEventListener('change', (ev) => { state.pauses = ev.target.checked; save(); paint(); });
  $('edit').addEventListener('click', openEditor);
  $('done').addEventListener('click', closeEditor);
  $('clear').addEventListener('click', () => { $('src').value = ''; srcMeta(); $('src').focus(); });
  $('src').addEventListener('input', srcMeta);
  $('stage').addEventListener('click', toggle);

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
    shown = { a: 0, b: words.length };   // repaint every word when coming back to the text
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
    const t = ev.target;
    if (t.matches('textarea')) {
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); closeEditor(); }
      return;
    }
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
      ',': () => setSize(state.size - 1), '<': () => setSize(state.size - 1),
      '.': () => setSize(state.size + 1), '>': () => setSize(state.size + 1),
    }[k.length === 1 ? k.toLowerCase() : k];
    if (!act || (t.matches('input[type=range]') && k.startsWith('Arrow'))) return;
    ev.preventDefault();
    act();
  });

  // drop a text file anywhere
  let dragDepth = 0;
  const hasFile = (ev) => [...(ev.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (ev) => { if (hasFile(ev)) { dragDepth++; $('drop').hidden = false; } });
  document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
  document.addEventListener('dragover', (ev) => { if (hasFile(ev)) ev.preventDefault(); });
  document.addEventListener('drop', async (ev) => {
    if (!hasFile(ev)) return;
    ev.preventDefault();
    dragDepth = 0; $('drop').hidden = true;
    const f = ev.dataTransfer.files[0];
    if (!f) return;
    if (!/^text\/|json|xml|markdown/.test(f.type) && !/\.(txt|md|markdown|text|csv|html?)$/i.test(f.name)) return toast('That doesn’t look like a text file');
    $('editor').hidden = true;
    setText(await f.text(), `Loaded ${f.name}`);
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
    if (ev.key !== KEY || playing) return;
    const textBefore = state.text;
    state = load();
    if (state.text !== textBefore) buildText();
    paint();
  });

  // Shared to the installed app, or opened as ?text=…: read that.
  const q = new URLSearchParams(location.search);
  const shared = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n\n');
  if (shared) state.text = shared, state.pos = 0;
  if (location.search) history.replaceState(null, '', location.pathname);

  buildText();
  if (state.theme !== 'auto') document.documentElement.dataset.theme = state.theme;
  if (shared) save();
  paint(state.pos > 0);   // reopen where you left off

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
