'use strict';
/* ================= Player-Backend: Samsung AVPlay oder HTML5 ================= */
const GER = {
  ger: 'Deutsch', deu: 'Deutsch', de: 'Deutsch', eng: 'Englisch', en: 'Englisch', fra: 'Französisch', fre: 'Französisch',
  fr: 'Französisch', ita: 'Italienisch', it: 'Italienisch', spa: 'Spanisch', es: 'Spanisch', tur: 'Türkisch', tr: 'Türkisch',
  rus: 'Russisch', ru: 'Russisch', pol: 'Polnisch', pl: 'Polnisch', por: 'Portugiesisch', ara: 'Arabisch', und: 'Unbekannt'
};
const langName = c => GER[String(c || '').toLowerCase()] || (c ? String(c).toUpperCase() : 'Unbekannt');

const PB = (() => {
  const vid = $('vid');
  const hasAV = () => typeof webapis !== 'undefined' && !!webapis && !!webapis.avplay;
  const A = () => webapis.avplay;
  // Zusatz-Player (laufen über Media Source Extensions im normalen <video>-Element)
  const LIBS = {
    hls: ['https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js', 'https://unpkg.com/hls.js@1.5.15/dist/hls.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.15/hls.min.js', 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js'],
    mpegts: ['https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.js', 'https://unpkg.com/mpegts.js@1.7.3/dist/mpegts.js', 'https://cdn.jsdelivr.net/npm/mpegts.js@1/dist/mpegts.js']
  };
  const libP = {};
  const libGet = n => (n === 'hls' ? window.Hls : window.mpegts);
  function loadLib(n) {
    if (libP[n]) return libP[n];
    libP[n] = new Promise((res, rej) => {
      if (libGet(n)) { res(libGet(n)); return; }
      const urls = LIBS[n].slice();
      const next = () => {
        const u = urls.shift();
        if (!u) { delete libP[n]; rej(new Error(n + '-Bibliothek nicht ladbar (Internet/CDN gesperrt?)')); return; }
        const sc = document.createElement('script');
        sc.src = u; sc.onload = () => { if (libGet(n)) res(libGet(n)); else next(); }; sc.onerror = next;
        document.head.appendChild(sc);
      };
      next();
    });
    return libP[n];
  }

  let mode = '', cb = {}, cur = 0, dur = 0, paused = false, tm = 0, gen = 0, H = null, fire = () => {}, ready = () => {};
  const msed = () => mode === 'html' || mode === 'hls' || mode === 'mpegts';
  function safePlay() { try { const p = vid.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }

  function stop() {
    gen++; clearInterval(tm);
    try { if (mode === 'av') { A().stop(); A().close(); } } catch (e) { /* ignore */ }
    try {
      if (H) {
        if (mode === 'hls') H.destroy();
        else { H.pause(); H.unload(); H.detachMediaElement(); H.destroy(); }
      }
    } catch (e) { /* ignore */ }
    H = null;
    try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (e) { /* ignore */ }
    mode = '';
  }
  vid.addEventListener('error', () => {
    if (!msed()) return;
    const c = vid.error ? vid.error.code : 0;
    fire('err', 'Video-Fehler ' + c + (c === 4 ? ' (Format/Codec nicht unterstützt)' : ''));
  });
  vid.addEventListener('ended', () => { if (msed()) fire('end'); });
  vid.addEventListener('waiting', () => { if (msed()) fire('buf', true); });
  vid.addEventListener('playing', () => { if (msed()) { fire('buf', false); ready(); } });

  function open(url, from, engine, callbacks) {
    stop();
    const g = ++gen;
    cb = callbacks || {}; cur = 0; dur = 0; paused = false;
    let errored = false, readySent = false;
    fire = (n, a) => {
      if (g !== gen) return;
      if (n === 'err') { if (errored) return; errored = true; }
      if (cb[n]) cb[n](a);
    };
    ready = () => { if (!readySent && g === gen) { readySent = true; fire('ready'); } };
    const f = fire;
    mode = engine === 'av' && hasAV() ? 'av' : (engine === 'hls' || engine === 'mpegts' ? engine : 'html');
    document.body.setAttribute('data-eng', mode === 'av' ? 'av' : 'html');
    tm = setInterval(() => {
      try {
        if (mode === 'av') cur = A().getCurrentTime() / 1000;
        else if (msed()) { cur = vid.currentTime || 0; dur = isFinite(vid.duration) ? vid.duration : 0; }
      } catch (e) { /* Zustand noch nicht bereit */ }
    }, 400);

    if (mode === 'av') {
      try {
        const a = A();
        a.open(url);
        a.setDisplayRect(0, 0, window.innerWidth || 1920, window.innerHeight || 1080);
        a.setListener({
          onbufferingstart: () => f('buf', true),
          onbufferingcomplete: () => f('buf', false),
          oncurrentplaytime: ms => { cur = ms / 1000; },
          onstreamcompleted: () => f('end'),
          onerror: e => f('err', 'AVPlay-Fehler: ' + e),
          onsubtitlechange: (d, t) => f('sub', { d, t })
        });
        a.prepareAsync(() => {
          try {
            dur = a.getDuration() / 1000;
            if (from > 0) a.seekTo(Math.floor(from * 1000));
            a.play();
          } catch (e) { f('err', 'AVPlay play: ' + (e.message || e)); return; }
          ready();
        }, e => f('err', 'AVPlay prepare: ' + ((e && e.name) || e)));
      } catch (e) { f('err', 'AVPlay open: ' + (e.message || e)); }
    } else if (mode === 'hls') {
      loadLib('hls').then(Hls => {
        if (g !== gen) return;
        if (!Hls.isSupported()) { f('err', 'hls.js: MSE hier nicht unterstützt'); return; }
        let rec = false;
        const h = new Hls({ enableWorker: false, maxBufferLength: 20, maxMaxBufferLength: 40, backBufferLength: 10, manifestLoadingTimeOut: 12000, levelLoadingTimeOut: 12000, fragLoadingTimeOut: 20000 });
        H = h;
        h.on(Hls.Events.ERROR, (e, d) => {
          if (!d || !d.fatal) return;
          if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !rec) { rec = true; try { h.recoverMediaError(); return; } catch (x) { /* weiter */ } }
          f('err', 'HLS ' + d.type + ': ' + d.details + (d.response && d.response.code ? ' (HTTP ' + d.response.code + ')' : ''));
        });
        h.on(Hls.Events.MANIFEST_PARSED, safePlay);
        h.loadSource(url); h.attachMedia(vid);
      }, e => f('err', e.message));
    } else if (mode === 'mpegts') {
      loadLib('mpegts').then(M => {
        if (g !== gen) return;
        if (!M.isSupported()) { f('err', 'mpegts.js: MSE hier nicht unterstützt'); return; }
        const p = M.createPlayer({ type: 'mpegts', isLive: true, url: url }, { enableWorker: false, autoCleanupSourceBuffer: true });
        H = p;
        p.on(M.Events.ERROR, (t, d, info) => f('err', 'TS ' + t + ': ' + d + (info && info.code ? ' (' + info.code + ')' : '')));
        p.attachMediaElement(vid); p.load(); safePlay();
      }, e => f('err', e.message));
    } else {
      vid.src = url;
      const meta = () => {
        vid.removeEventListener('loadedmetadata', meta);
        if (from > 0) { try { vid.currentTime = from; } catch (e) { /* ignore */ } }
      };
      vid.addEventListener('loadedmetadata', meta);
      safePlay();
    }
  }
  function toggle() {
    try {
      if (mode === 'av') {
        if (A().getState() === 'PLAYING') { A().pause(); paused = true; } else { A().play(); paused = false; }
      } else if (vid.paused) { safePlay(); paused = false; } else { vid.pause(); paused = true; }
    } catch (e) { /* ignore */ }
    return paused;
  }
  function seekTo(s) {
    s = Math.max(0, dur > 3 ? Math.min(s, dur - 3) : s);
    try { if (mode === 'av') A().seekTo(Math.floor(s * 1000)); else vid.currentTime = s; cur = s; } catch (e) { /* ignore */ }
  }
  function tracks() {
    const r = { audio: [], text: [], ca: -1, ct: -1 };
    try {
      if (mode === 'av') {
        (A().getTotalTrackInfo() || []).forEach(t => {
          let x = {}; try { x = JSON.parse(t.extra_info || '{}'); } catch (e) { /* ignore */ }
          const l = langName(x.language) + (x.channels ? ' · ' + x.channels + ' Kanäle' : '');
          if (t.type === 'AUDIO') r.audio.push({ i: t.index, l });
          else if (t.type === 'TEXT') r.text.push({ i: t.index, l });
        });
        (A().getCurrentStreamInfo() || []).forEach(t => {
          if (t.type === 'AUDIO') r.ca = t.index;
          if (t.type === 'TEXT') r.ct = t.index;
        });
      } else if (mode === 'hls' && H && H.audioTracks && H.audioTracks.length > 1) {
        H.audioTracks.forEach((t, i) => r.audio.push({ i, l: langName(t.lang) + (t.name && t.name !== t.lang ? ' – ' + t.name : '') }));
        r.ca = H.audioTrack;
      } else if (mode === 'html') {
        const at = vid.audioTracks;
        if (at && at.length > 1) {
          for (let i = 0; i < at.length; i++) { r.audio.push({ i, l: langName(at[i].language) + (at[i].label ? ' – ' + at[i].label : '') }); if (at[i].enabled) r.ca = i; }
        }
      }
    } catch (e) { /* ignore */ }
    return r;
  }
  function setAudio(i) {
    try {
      if (mode === 'av') A().setSelectTrack('AUDIO', i);
      else if (mode === 'hls') H.audioTrack = i;
      else for (let k = 0; k < vid.audioTracks.length; k++) vid.audioTracks[k].enabled = k === i;
    } catch (e) { /* ignore */ }
  }
  function setText(i) {
    try {
      if (mode !== 'av') return;
      if (i < 0) A().setSilentSubtitle(true);
      else { A().setSelectTrack('TEXT', i); A().setSilentSubtitle(false); }
    } catch (e) { /* ignore */ }
  }
  return { hasAV, open, stop, toggle, seekTo, tracks, setAudio, setText, time: () => cur, dur: () => dur, paused: () => paused, mode: () => mode };
})();

/* ================= Player-Oberfläche ================= */
let np = null, backTo = 'home', lastSave = 0, ctlShown = false, ctlT = 0, ctlF = 0, pend = 0, pendBase = 0, pendT = 0;
let menuOpen = false, menuItems = [], menuF = 0, pollT = 0, subT = 0, busyT = 0;

const setBusy = (m, ms) => {
  $('busy').textContent = m || '';
  clearTimeout(busyT);
  if (m && ms) busyT = setTimeout(() => { $('busy').textContent = ''; }, ms);
};

// o: {kind:'live'|'vod'|'ep', it, from, title, key, img, ser, list, idx, nextOpts}
const ENGN = { av: 'AVPlay', hls: 'hls.js', mpegts: 'mpegts.js', html: 'HTML5' };
// Reihenfolge der Abspiel-Versuche; was zuletzt funktioniert hat, kommt zuerst
function planFor(o) {
  const av = PB.hasAV(), pl = [];
  if (o.kind !== 'live') {
    if (av) pl.push({ e: 'av' });
    pl.push({ e: 'html' });
    return pl;
  }
  const fm = P.type === 'm3u' ? [/\.m3u8?(\?|$)/i.test(o.it.e) ? 'm3u8' : 'ts'] : ['m3u8', 'ts'];
  if (av) fm.forEach(f => pl.push({ e: 'av', f }));
  fm.forEach(f => pl.push({ e: f === 'm3u8' ? 'hls' : 'mpegts', f }));
  fm.forEach(f => pl.push({ e: 'html', f }));
  const pe = String(LS.get('pe', ''));
  const i = pl.findIndex(x => x.e + '|' + (x.f || '') === pe);
  if (i > 0) pl.unshift(pl.splice(i, 1)[0]);
  return pl;
}
function openPlayer(o) {
  o.plan = planFor(o); o.pi = 0; o.started = false; o.log = [];
  np = o;
  if (screen !== 'player') backTo = screen;
  show('player');
  $('sub').textContent = '';
  ctlF = o.kind === 'live' ? 1 : 0;
  startStream(o.from || 0);
  clearInterval(pollT); pollT = setInterval(poll, 500);
  showCtl();
}
function startStream(from) {
  const o = np; if (!o) return;
  const st = o.plan[o.pi]; o.from = from; o.started = false;
  const url = streamUrl(o.kind, o.it, st.f || null);
  $('p-title').textContent = o.title;
  setBusy('Lade … (' + ENGN[st.e] + (st.f ? ' · ' + st.f : '') + ')');
  clearTimeout(o.wd);
  o.wd = setTimeout(() => { if (np === o && !o.started) onErr('Timeout – nach 15 s weder Bild noch Ton'); }, 15000);
  PB.open(url, from, st.e, {
    ready: () => { if (np === o) { o.started = true; setBusy(''); clearTimeout(o.wd); LS.set('pe', st.e + '|' + (st.f || '')); } },
    err: m => { if (np === o) onErr(m); },
    end: () => { if (np === o) onEnd(); },
    buf: b => { if (np === o && o.started) setBusy(b ? 'Puffert …' : ''); },
    sub: onSub
  });
  $('p-eng').textContent = 'Player: ' + ENGN[st.e] + (st.f ? ' · ' + st.f : '') + ' (' + (o.pi + 1) + '/' + o.plan.length + ')' + (PB.hasAV() ? '' : ' · AVPlay nicht verfügbar');
}
function restartStream() {
  if (!np) return;
  startStream(np.kind === 'live' ? 0 : PB.time());
}
function onErr(msg) {
  const o = np; if (!o) return;
  clearTimeout(o.wd);
  const st = o.plan[o.pi];
  o.log.push(ENGN[st.e] + (st.f ? '/' + st.f : '') + ': ' + msg);
  if (o.started) { setBusy(msg, 4000); return; }
  if (o.pi + 1 < o.plan.length) { o.pi++; setBusy('Versuche nächste Variante …'); startStream(o.from || 0); return; }
  PB.stop();
  setBusy('Wiedergabe nicht möglich\n' + o.log.slice(-5).join('\n') + '\n\nZurück: schließen · Menü „Quelle“: Variante wählen');
  showCtl();
}
function onEnd() {
  const o = np; if (!o || o.kind === 'live') return;
  delete pos[o.key]; LS.set('pos', pos);
  const nx = o.nextOpts && o.nextOpts();
  if (nx) { openPlayer(nx); return; }
  closePlayer();
}
function onSub(s) {
  clearTimeout(subT);
  $('sub').textContent = String(s.t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  subT = setTimeout(() => { $('sub').textContent = ''; }, s.d || 3000);
}
function savePos() {
  const o = np; if (!o || o.kind === 'live') return;
  const t = PB.time(), d = PB.dur();
  if (!(d > 0)) return;
  if (t > d * 0.95) delete pos[o.key];
  else if (t > 15) {
    const s = o.ser;
    pos[o.key] = {
      t: Math.floor(t), d: Math.floor(d), u: Date.now(), n: o.title, i: o.img || '', kind: o.kind,
      it: { id: o.it.id, e: o.it.e, k: o.it.k, n: o.it.n, i: o.it.i, pt: o.it.pt },
      ser: s ? { k: s.k, id: s.id, n: s.n, i: s.i, pt: s.pt, pl: s.pl, e: s.e } : null
    };
  }
  const ks = Object.keys(pos);
  if (ks.length > 400) ks.sort((a, b) => (pos[a].u || 0) - (pos[b].u || 0)).slice(0, 100).forEach(k => { delete pos[k]; });
  LS.set('pos', pos); lastSave = Date.now();
}
function poll() {
  if (!np) return;
  const t = PB.time(), d = PB.dur();
  if (t > (np.from || 0) + 0.5 && !np.started) { np.started = true; clearTimeout(np.wd); setBusy(''); }
  if (ctlShown) renderBar(t, d);
  if (np.kind !== 'live' && Date.now() - lastSave > 10000) savePos();
}
function closePlayer() {
  const o = np;
  savePos(); np = null;
  clearTimeout(ctlT); clearInterval(pollT); clearTimeout(pendT); clearTimeout(subT); pend = 0;
  if (o) clearTimeout(o.wd);
  PB.stop();
  menuOpen = false; $('menu').classList.remove('on');
  $('sub').textContent = ''; setBusy('');
  hideCtl();
  show(backTo || 'home');
  afterPlayer();
}

/* ---- Steuerleiste ---- */
const pbBtns = () => [].slice.call($('ctl').querySelectorAll('[data-pb]')).filter(b => b.offsetParent);
function renderBar(t, d) {
  if (!np) return;
  const live = np.kind === 'live';
  $('ctl').classList.toggle('live', live);
  $('pb-play').textContent = PB.paused() ? 'Weiter' : 'Pause';
  if (live || !(d > 0)) return;
  const shown = pend ? Math.max(0, Math.min(d, pendBase + pend)) : t, p = shown / d * 100;
  $('bar-fill').style.width = p + '%'; $('bar-knob').style.left = p + '%';
  $('t-cur').textContent = fmt(shown); $('t-dur').textContent = '-' + fmt(d - shown);
}
function renderCtlFocus() {
  $('bar').classList.toggle('rf', ctlF === 0);
  pbBtns().forEach((b, i) => b.classList.toggle('rf', ctlF === i + 1));
}
function showCtl() {
  ctlShown = true;
  $('ctl').classList.add('on'); $('p-top').classList.add('on');
  renderBar(PB.time(), PB.dur()); renderCtlFocus();
  clearTimeout(ctlT);
  if (!menuOpen) ctlT = setTimeout(hideCtl, 5000);
}
function hideCtl() {
  ctlShown = false;
  $('ctl').classList.remove('on'); $('p-top').classList.remove('on');
}
function seekBy(s) {
  const d = PB.dur();
  if (!np || np.kind === 'live' || !(d > 0)) return;
  if (!pend) pendBase = PB.time();
  pend += s;
  clearTimeout(pendT);
  pendT = setTimeout(() => { PB.seekTo(pendBase + pend); pend = 0; }, 450);
  renderBar(PB.time(), d);
}
function togglePlay() { const p = PB.toggle(); setBusy(p ? 'Pause' : ''); renderBar(PB.time(), PB.dur()); }
function zap(dir) {
  const o = np; if (!o || !o.list) return;
  const j = o.idx + dir, it = o.list[j];
  if (!it) return;
  if (o.list === GRID.items) GRID.idx = j;
  openPlayer({ kind: 'live', it, title: it.n, key: it.k, img: it.i, list: o.list, idx: j });
}
function pbAction(a) {
  if (a === 'play') togglePlay();
  else if (a === 'back') seekBy(-10);
  else if (a === 'fwd') seekBy(10);
  else openMenu(a);
}

/* ---- Menü: Tonspur / Untertitel / Quelle ---- */
function openMenu(kind) {
  menuItems = []; let title = '', note = '';
  const t = PB.tracks();
  if (kind === 'audio') {
    title = 'Tonspur';
    t.audio.forEach(a => menuItems.push({ l: a.l, on: a.i === t.ca, f: () => PB.setAudio(a.i) }));
    if (!menuItems.length) note = (PB.mode() === 'av' || PB.mode() === 'hls') ? 'Dieser Stream hat nur eine Tonspur.' : 'Tonspur-Auswahl gibt es nur mit AVPlay oder hls.js (Menü „Quelle“).';
  } else if (kind === 'sub') {
    title = 'Untertitel';
    if (t.text.length) {
      menuItems.push({ l: 'Aus', on: t.ct < 0, f: () => PB.setText(-1) });
      t.text.forEach(a => menuItems.push({ l: a.l, on: a.i === t.ct, f: () => PB.setText(a.i) }));
    } else note = PB.mode() === 'av' ? 'Dieser Stream hat keine eingebetteten Untertitel.' : 'Untertitel gehen nur mit AVPlay (Menü „Quelle“).';
  } else {
    title = 'Quelle & Wiedergabe';
    np.plan.forEach((st, i) => menuItems.push({ l: ENGN[st.e] + (st.f ? ' · ' + st.f : ''), on: i === np.pi, f: () => { np.pi = i; restartStream(); } }));
    if (!PB.hasAV()) menuItems.push({ l: 'AVPlay (Samsung) ist hier nicht verfügbar', on: false, f: () => {} });
  }
  $('menu-t').textContent = title;
  const list = $('menu-list'); list.innerHTML = '';
  menuItems.forEach(m => { m.n = mk('mi' + (m.on ? ' on' : ''), m.l); list.appendChild(m.n); });
  if (note) list.appendChild(mk('mn', note));
  menuOpen = true; menuF = 0;
  menuItems.forEach((m, i) => { if (m.on) menuF = i; });
  renderMenu();
  $('menu').classList.add('on');
  clearTimeout(ctlT);
}
function renderMenu() { menuItems.forEach((m, i) => m.n.classList.toggle('rf', i === menuF)); }
function closeMenu() { menuOpen = false; $('menu').classList.remove('on'); showCtl(); }
function menuKey(k, d, back) {
  if (back) { closeMenu(); return; }
  if (d && d[1]) { menuF = Math.max(0, Math.min(menuItems.length - 1, menuF + d[1])); renderMenu(); }
  else if (k === 13) { const m = menuItems[menuF]; closeMenu(); if (m) m.f(); }
}

/* ---- Tasten im Player ---- */
function playerKey(e, k, d) {
  const back = k === 10009 || k === 27;
  if (menuOpen) { e.preventDefault(); menuKey(k, d, back); return; }
  if (!np) return;
  const live = np.kind === 'live';
  if (back || k === 413) { e.preventDefault(); closePlayer(); return; }
  if (k === 415 || k === 19 || k === 10252) { e.preventDefault(); togglePlay(); return; }
  if (k === 417 || k === 412) { e.preventDefault(); seekBy(k === 417 ? 30 : -30); showCtl(); return; }
  if (k === 427 || k === 428) { e.preventDefault(); if (live) zap(k === 427 ? 1 : -1); return; }
  if (!d && k !== 13) return;
  e.preventDefault();
  if (!ctlShown) {
    if (k === 13) { togglePlay(); showCtl(); return; }
    if (live && d[1]) { zap(d[1]); return; }
    ctlF = live ? 1 : 0;
    showCtl();
    if (!live && d[0]) seekBy(d[0] * 10);
    return;
  }
  showCtl();
  if (live && d && d[1]) { zap(d[1]); return; }
  const n = pbBtns().length;
  if (ctlF === 0) {
    if (d && d[0]) seekBy(d[0] * (e.repeat ? 30 : 10));
    else if (d && d[1] > 0) ctlF = 1;
    else if (k === 13) togglePlay();
  } else if (d && d[0]) ctlF = Math.max(1, Math.min(n, ctlF + d[0]));
  else if (d && d[1] < 0 && !live) ctlF = 0;
  else if (k === 13) { const b = pbBtns()[ctlF - 1]; if (b) pbAction(b.getAttribute('data-pb')); }
  renderCtlFocus();
}
