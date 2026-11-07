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
  let mode = '', cb = {}, cur = 0, dur = 0, paused = false, tm = 0;
  const ev = (n, a) => { if (cb[n]) cb[n](a); };

  function stop() {
    clearInterval(tm);
    try { if (mode === 'av') { A().stop(); A().close(); } } catch (e) { /* ignore */ }
    try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (e) { /* ignore */ }
    mode = '';
  }
  vid.addEventListener('error', () => {
    if (mode !== 'html') return;
    const c = vid.error ? vid.error.code : 0;
    ev('err', 'HTML5-Fehler ' + c + (c === 4 ? ' (Format/Codec nicht unterstützt)' : ''));
  });
  vid.addEventListener('ended', () => { if (mode === 'html') ev('end'); });
  vid.addEventListener('waiting', () => { if (mode === 'html') ev('buf', true); });
  vid.addEventListener('playing', () => { if (mode === 'html') ev('buf', false); });

  function open(url, from, engine, callbacks) {
    stop();
    cb = callbacks || {}; cur = 0; dur = 0; paused = false;
    mode = engine === 'av' && hasAV() ? 'av' : 'html';
    document.body.setAttribute('data-eng', mode);
    tm = setInterval(() => {
      try {
        if (mode === 'av') cur = A().getCurrentTime() / 1000;
        else if (mode === 'html') { cur = vid.currentTime || 0; dur = isFinite(vid.duration) ? vid.duration : 0; }
      } catch (e) { /* Zustand noch nicht bereit */ }
    }, 400);
    if (mode === 'av') {
      try {
        const a = A();
        a.open(url);
        a.setDisplayRect(0, 0, window.innerWidth || 1920, window.innerHeight || 1080);
        a.setListener({
          onbufferingstart: () => ev('buf', true),
          onbufferingcomplete: () => ev('buf', false),
          oncurrentplaytime: ms => { cur = ms / 1000; },
          onstreamcompleted: () => ev('end'),
          onerror: e => ev('err', 'AVPlay-Fehler: ' + e),
          onsubtitlechange: (d, t) => ev('sub', { d, t })
        });
        a.prepareAsync(() => {
          try {
            dur = a.getDuration() / 1000;
            if (from > 0) a.seekTo(Math.floor(from * 1000));
            a.play();
          } catch (e) { ev('err', 'AVPlay play: ' + (e.message || e)); return; }
          ev('ready');
        }, e => ev('err', 'AVPlay prepare: ' + ((e && e.name) || e)));
      } catch (e) { ev('err', 'AVPlay open: ' + (e.message || e)); }
    } else {
      vid.src = url;
      const meta = () => {
        vid.removeEventListener('loadedmetadata', meta);
        if (from > 0) { try { vid.currentTime = from; } catch (e) { /* ignore */ } }
        ev('ready');
      };
      vid.addEventListener('loadedmetadata', meta);
      const pr = vid.play();
      if (pr && pr.catch) pr.catch(() => {});
    }
  }
  function toggle() {
    try {
      if (mode === 'av') {
        if (A().getState() === 'PLAYING') { A().pause(); paused = true; } else { A().play(); paused = false; }
      } else if (vid.paused) { vid.play(); paused = false; } else { vid.pause(); paused = true; }
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
      } else {
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
let menuOpen = false, menuItems = [], menuF = 0, pollT = 0, engine = 'av', subT = 0, busyT = 0;

const setBusy = (m, ms) => {
  $('busy').textContent = m || '';
  clearTimeout(busyT);
  if (m && ms) busyT = setTimeout(() => { $('busy').textContent = ''; }, ms);
};

// o: {kind:'live'|'vod'|'ep', it, from, title, key, img, ser, list, idx, nextOpts}
function openPlayer(o) {
  o.formats = o.kind === 'live' && P.type === 'xtream' ? ['m3u8', 'ts'] : [null];
  o.fi = 0; o.tried = {}; o.started = false;
  np = o;
  if (screen !== 'player') backTo = screen;
  show('player');
  engine = PB.hasAV() ? LS.get('engine', 'av') : 'html';
  $('sub').textContent = '';
  ctlF = o.kind === 'live' ? 1 : 0;
  startStream(o.from || 0);
  clearInterval(pollT); pollT = setInterval(poll, 500);
  showCtl();
}
function startStream(from) {
  const o = np; if (!o) return;
  o.tried[engine] = 1; o.from = from;
  const url = streamUrl(o.kind, o.it, o.formats[o.fi]);
  $('p-title').textContent = o.title;
  setBusy('Lade …');
  clearTimeout(o.wd);
  o.wd = setTimeout(() => { if (np === o && !o.started) onErr('Timeout – nach 15 s weder Bild noch Ton'); }, 15000);
  PB.open(url, from, engine, {
    ready: () => { if (np === o) { o.started = true; setBusy(''); clearTimeout(o.wd); } },
    err: m => { if (np === o) onErr(m); },
    end: () => { if (np === o) onEnd(); },
    buf: b => { if (np === o && o.started) setBusy(b ? 'Puffert …' : ''); },
    sub: onSub
  });
  $('p-eng').textContent = 'Player: ' + (PB.mode() === 'av' ? 'AVPlay' : 'HTML5' + (PB.hasAV() ? '' : ' (AVPlay hier nicht verfügbar)')) + (o.formats[o.fi] ? ' · Format ' + o.formats[o.fi] : '');
}
function restartStream() {
  if (!np) return;
  np.started = false; np.tried = {};
  startStream(np.kind === 'live' ? 0 : PB.time());
}
function onErr(msg) {
  const o = np; if (!o) return;
  clearTimeout(o.wd);
  o.log = (o.log || []).concat((PB.mode() === 'av' ? 'AVPlay' : 'HTML5') + '/' + (o.formats[o.fi] || 'direkt') + ': ' + msg);
  if (o.started) { setBusy(msg, 4000); return; }
  if (o.fi + 1 < o.formats.length) { o.fi++; setBusy('Versuche anderes Format …'); startStream(o.from || 0); return; }
  const other = engine === 'av' ? 'html' : 'av';
  if (!o.tried[other] && (other === 'html' || PB.hasAV())) {
    engine = other; o.fi = 0; setBusy('Versuche anderen Player …'); startStream(o.from || 0); return;
  }
  PB.stop();
  setBusy('Wiedergabe nicht möglich\n' + o.log.slice(-4).join('\n') + '\n\nZurück-Taste: schließen · Menü „Quelle“: Format/Player wechseln');
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
    if (!menuItems.length) note = PB.mode() === 'av' ? 'Dieser Stream hat nur eine Tonspur.' : 'Tonspur-Auswahl geht nur mit AVPlay (Menü „Quelle“).';
  } else if (kind === 'sub') {
    title = 'Untertitel';
    if (t.text.length) {
      menuItems.push({ l: 'Aus', on: t.ct < 0, f: () => PB.setText(-1) });
      t.text.forEach(a => menuItems.push({ l: a.l, on: a.i === t.ct, f: () => PB.setText(a.i) }));
    } else note = PB.mode() === 'av' ? 'Dieser Stream hat keine eingebetteten Untertitel.' : 'Untertitel gehen nur mit AVPlay (Menü „Quelle“).';
  } else {
    title = 'Quelle & Wiedergabe';
    if (np.formats.length > 1) np.formats.forEach((f, i) => menuItems.push({ l: 'Format: ' + f, on: i === np.fi, f: () => { np.fi = i; restartStream(); } }));
    menuItems.push({ l: 'Player: AVPlay (Samsung)' + (PB.hasAV() ? '' : ' – nicht verfügbar'), on: engine === 'av', f: () => { if (PB.hasAV()) { engine = 'av'; LS.set('engine', 'av'); restartStream(); } } });
    menuItems.push({ l: 'Player: HTML5', on: engine === 'html', f: () => { engine = 'html'; LS.set('engine', 'html'); restartStream(); } });
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
