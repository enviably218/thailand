import * as C from './common.js';

const KEY_STORE = 'reisblog-sleutel';
const S = {
  cfg: null, trip: null, posts: [], tracks: {}, routes: {}, meta: null, key: null,
  exact: new Map(), exactInfo: new Map(), map: null, layers: null, mini: new Map(),
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

init().catch((e) => {
  console.error(e);
  $('#posts').innerHTML = `<p class="empty">De blog kon niet geladen worden. Probeer het later opnieuw.</p>`;
});

async function init() {
  $$('.ico').forEach((el) => { if (el.textContent === '__MAIL__') el.innerHTML = C.ICONS.mail; });
  const [cfg, trip, posts, meta] = await Promise.all([
    C.getJSON('config.json'), C.getJSON('data/trip.json'), C.getJSON('data/posts.json'), C.getJSON('data/crypto.json'),
  ]);
  S.cfg = cfg || {}; S.trip = trip; S.posts = (posts || []).sort((a, b) => Date.parse(b.time) - Date.parse(a.time)); S.meta = meta;
  await loadGeometry();
  S.key = meta ? await C.loadKey(KEY_STORE, meta) : null;
  if (S.key) await decryptAll();
  renderHeader();
  renderSubscribe();
  renderLock();
  initMap();
  renderAll();
  bindUI();
  setInterval(() => { renderStatus(); }, 30000);
  setInterval(refresh, 5 * 60000);
  if (location.hash.startsWith('#post-')) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 400);
}

async function loadGeometry() {
  const jobs = S.trip.events.map(async (e) => {
    if (e.type === 'flight') {
      const t = await C.getJSON(`data/tracks/${e.id}.json`).catch(() => null);
      if (t) S.tracks[e.id] = t;
    } else if (e.type === 'train' && e.route) {
      const r = await C.getJSON(e.route, { fresh: false }).catch(() => null);
      if (r) S.routes[e.id] = r.points;
    }
  });
  await Promise.all(jobs);
}

async function refresh() {
  try {
    const [posts, trip] = await Promise.all([C.getJSON('data/posts.json'), C.getJSON('data/trip.json')]);
    if (!posts || !trip) return;
    posts.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    const changed = JSON.stringify(posts) !== JSON.stringify(S.posts) || JSON.stringify(trip) !== JSON.stringify(S.trip);
    S.trip = trip; S.posts = posts;
    await loadGeometry();
    if (S.key) await decryptAll();
    if (changed) renderAll(); else { renderStatus(); drawJourney(); }
  } catch (e) { console.warn(e); }
}

async function decryptAll() {
  S.exact.clear(); S.exactInfo.clear();
  const items = [...S.posts.map((p) => [p.id, p.exact]), ...S.trip.events.filter((e) => e.exact).map((e) => [e.id, e.exact])];
  await Promise.all(items.map(async ([id, box]) => {
    if (!box) return;
    try {
      const v = await C.decryptJSON(S.key, box);
      S.exact.set(id, { lat: v.lat, lon: v.lon }); S.exactInfo.set(id, v);
    } catch { /* oud wachtwoord of beschadigd */ }
  }));
}

/* ---------------- header ---------------- */
function renderHeader() {
  const t = S.trip;
  document.title = `${t.title} · reisblog`;
  $('#title').textContent = t.title;
  $('#subtitle').textContent = t.subtitle || '';
  const stops = [];
  for (const e of t.events) {
    const add = (n) => { if (n && stops[stops.length - 1] !== n) stops.push(n); };
    if (e.type === 'flight' || e.type === 'train') { add(cityOf(e.from.name)); add(cityOf(e.to.name)); }
  }
  $('#routeChips').innerHTML = stops.map((s) => `<li>${C.esc(s)}</li>`).join('');
  $('#intro').innerHTML = C.md(t.intro);
  renderStatus();
}
function cityOf(name) {
  return String(name).replace(/ (Schiphol|International|Suvarnabhumi|Hamad International)$/i, '').replace(/^Station /, '').replace(/ \(.*\)$/, '');
}

function renderStatus() {
  const now = Date.now();
  const ph = C.currentPhase(S.trip, now);
  const el = $('#status');
  if (ph.phase === 'before') {
    const ms = ph.start - now;
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    const parts = d ? `${d} ${d === 1 ? 'dag' : 'dagen'} en ${h} uur` : h ? `${h} uur en ${m} min` : `${m} minuten`;
    el.innerHTML = `<span class="dot"></span>Nog <strong>${parts}</strong> tot vertrek · ${C.fmtDayLong(ph.start, C.NL_TZ)} om ${C.fmtTime(ph.start, C.NL_TZ)}`;
  } else if (ph.phase === 'after') {
    el.innerHTML = `<span class="dot done"></span>Weer thuis. Bedankt voor het meelezen!`;
  } else {
    const e = ph.active;
    const tz = e ? (e.type === 'flight' || e.type === 'train' ? e.end.tz : e.start.tz) : 'Asia/Bangkok';
    const today = C.ymd(now, tz);
    const day = C.dayNumber(today, S.trip.dayZero);
    const total = C.dayNumber(C.ymd(ph.end, C.NL_TZ), S.trip.dayZero);
    let where = '';
    if (e?.type === 'flight') where = `onderweg: ${C.esc(C.eventTitle(e))}`;
    else if (e?.type === 'train') where = `in de trein naar ${C.esc(cityOf(e.to.name))}`;
    else if (e?.type === 'layover') where = C.esc(e.title.toLowerCase());
    else if (e?.type === 'stay') where = `nu in ${C.esc(e.title)}`;
    else if (e) where = C.esc(e.title);
    const lt = C.fmtTime(now, tz);
    const nl = C.fmtTime(now, C.NL_TZ);
    const tzTxt = tz === C.NL_TZ ? `${nl} NL` : `${lt} ${C.TZ_NAME[tz] || 'lokaal'} (${nl} NL)`;
    el.innerHTML = `<span class="dot live"></span><strong>Dag ${day} van ${total}</strong><span class="sep">·</span>${where}<span class="sep">·</span>${tzTxt}`;
  }
}

function renderSubscribe() {
  const user = (S.cfg.buttondown || '').trim();
  if (!user) return;
  const box = $('#subscribe');
  box.hidden = false;
  $('#subscribeForm').action = `https://buttondown.com/api/emails/embed-subscribe/${encodeURIComponent(user)}`;
}

function renderLock() {
  const btn = $('#lockBtn');
  if (!S.meta) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.innerHTML = S.key ? `${C.ICONS.unlock}<span>Exacte locaties aan</span>` : `${C.ICONS.lock}<span>Exacte locaties</span>`;
  btn.classList.toggle('on', !!S.key);
}

/* ---------------- kaart ---------------- */
const BOUNDS = { thailand: [[6.2, 97.2], [20.6, 101.6]] };
function initMap() {
  S.map = L.map('map', { zoomSnap: 0.25, scrollWheelZoom: false, worldCopyJump: false });
  C.addTiles(S.map);
  S.map.fitBounds(BOUNDS.thailand);
  S.map.on('focus', () => S.map.scrollWheelZoom.enable());
  S.map.on('blur', () => S.map.scrollWheelZoom.disable());
  S.layers = L.layerGroup().addTo(S.map);
}
function drawJourney() {
  const now = Date.now();
  const L_ = S.layers;
  L_.clearLayers();
  const j = C.buildJourney({ trip: S.trip, posts: S.posts, tracks: S.tracks, routes: S.routes, now, exact: S.exact });
  // verblijven
  for (const e of S.trip.events.filter((x) => x.type === 'stay' && x.area)) {
    const t0 = Date.parse(e.start.utc), t1 = Date.parse(e.end.utc);
    const past = now >= t0;
    const range = `${C.fmtShortDate(t0, e.start.tz)} – ${C.fmtShortDate(t1, e.end.tz)}`;
    L.circle([e.area.lat, e.area.lon], {
      radius: e.area.r, color: C.COLORS.stay, weight: 1.5, opacity: past ? 0.9 : 0.6,
      fillOpacity: past ? 0.12 : 0.05, dashArray: past ? null : '4 5',
    }).bindTooltip(`<strong>Verblijf · ${C.esc(e.area.label)}</strong><br>${range}`, { sticky: true }).addTo(L_);
    const ex = S.exactInfo.get(e.id);
    if (ex) {
      L.circleMarker([ex.lat, ex.lon], { radius: 7, color: '#fff', weight: 2, fillColor: C.COLORS.exact, fillOpacity: 1 })
        .bindTooltip(`<strong>Verblijf (exact)</strong><br>${C.esc(ex.address || '')}<br>${C.fmtCoord(ex.lat, ex.lon)}`).addTo(L_);
    }
  }
  // planning
  for (const line of j.planned) {
    L.polyline(line, { color: C.COLORS.planned, weight: 2, dashArray: '6 7', opacity: 0.9 }).addTo(L_);
  }
  // afgelegd
  if (j.done.length > 1) {
    L.polyline(j.done, { color: '#fff', weight: 6, opacity: 0.8 }).addTo(L_);
    L.polyline(j.done, { color: C.COLORS.done, weight: 3, opacity: 0.95, lineJoin: 'round' }).addTo(L_);
  }
  // knooppunten (vliegvelden/stations)
  const nodes = new Map();
  for (const e of S.trip.events) for (const p of [e.from, e.to, e.place]) if (p) nodes.set(`${p.lat},${p.lon}`, p);
  for (const p of nodes.values()) {
    L.circleMarker([p.lat, p.lon], { radius: 4, color: '#3b3f46', weight: 1.5, fillColor: '#fff', fillOpacity: 1 })
      .bindTooltip(C.esc(p.name)).addTo(L_);
  }
  // berichten
  for (const p of S.posts) {
    const pt = S.exact.get(p.id) || p.loc;
    if (!pt) continue;
    L.circleMarker([pt.lat, pt.lon], { radius: 6, color: '#fff', weight: 2, fillColor: S.exact.has(p.id) ? C.COLORS.exact : C.COLORS.post, fillOpacity: 1 })
      .bindPopup(`<div class="pop"><strong>${C.esc(p.title)}</strong><br><span class="fine">${C.fmtDay(p.time, p.tz)} · ${C.dualTimeText(p.time, p.tz)}</span><br><a href="#post-${p.id}">Lees bericht</a></div>`)
      .addTo(L_);
  }
  // huidige positie
  if (j.current) {
    const icon = L.divIcon({ className: 'here', html: `<span class="here-dot ${j.current.type}">${C.typeIcon(j.current.type === 'stay' ? 'pin' : j.current.type)}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    const label = j.current.type === 'stay' ? `Nu in ${j.current.event.title}` : C.eventTitle(j.current.event);
    L.marker([j.current.lat, j.current.lon], { icon, zIndexOffset: 1000 }).bindTooltip(C.esc(label)).addTo(L_);
  }
  S.journey = j;
}
function fitView(view) {
  $$('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'thailand') S.map.fitBounds(BOUNDS.thailand);
  else if (view === 'all') {
    const pts = [];
    S.trip.events.forEach((e) => [e.from, e.to, e.place].forEach((p) => p && pts.push([p.lat, p.lon])));
    S.map.fitBounds(pts, { padding: [20, 20] });
  } else if (view === 'now') {
    const c = S.journey?.current;
    if (c) S.map.setView([c.lat, c.lon], c.type === 'flight' ? 5 : 12);
    else {
      const last = S.posts[0];
      const pt = last && (S.exact.get(last.id) || last.loc);
      if (pt) S.map.setView([pt.lat, pt.lon], 13); else fitView('all');
    }
  }
}

/* ---------------- tijdlijn ---------------- */
function renderTimeline() {
  const now = Date.now();
  const items = [];
  for (const e of S.trip.events) items.push({ kind: 'event', t: Date.parse(e.start.utc), tz: e.start.tz, e });
  for (const p of S.posts) items.push({ kind: 'post', t: Date.parse(p.time), tz: p.tz || 'Asia/Bangkok', p });
  items.sort((a, b) => a.t - b.t);
  const days = new Map();
  for (const it of items) {
    const d = C.ymd(it.t, it.tz);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(it);
  }
  const todayKeys = new Set([C.ymd(now, 'Asia/Bangkok'), C.ymd(now, C.NL_TZ)]);
  let html = '';
  for (const [d, list] of [...days.entries()].sort()) {
    const n = C.dayNumber(d, S.trip.dayZero);
    const dateObj = new Date(d + 'T12:00:00Z');
    const label = C.cap(C.fmtDayLong(dateObj, 'UTC'));
    html += `<div class="tl-day${todayKeys.has(d) ? ' today' : ''}" id="dag-${d}"><div class="tl-date"><span class="tl-n">${n >= 1 ? `Dag ${n}` : ''}</span><span>${label}</span></div><ul>`;
    for (const it of list) html += it.kind === 'event' ? tlEvent(it.e, now) : tlPost(it.p, now);
    html += `</ul></div>`;
  }
  $('#timeline').innerHTML = html;
  const el = $('#timeline .tl-item.now') || $('#timeline .tl-day.today');
  if (el) { const box = $('#timeline'); box.scrollTop = Math.max(0, el.offsetTop - box.offsetTop - 40); }
}
function tlEvent(e, now) {
  const t0 = Date.parse(e.start.utc), t1 = Date.parse(e.end.utc);
  const st = now >= t1 ? 'past' : now >= t0 ? 'now' : 'future';
  let sub = '';
  if (e.type === 'flight' || e.type === 'train') {
    sub = `aankomst ${C.dualTimeHTML(t1, e.end.tz)} · ${C.durationText(t1 - t0)}`;
    if (C.ymd(t1, e.end.tz) !== C.ymd(t0, e.start.tz)) sub = `aankomst ${C.fmtShortDate(t1, e.end.tz)}, ${C.dualTimeHTML(t1, e.end.tz)} · ${C.durationText(t1 - t0)}`;
    if (e.type === 'flight' && S.tracks[e.id]?.points?.length) sub += ` · <span class="tag">echte route</span>`;
  } else if (e.type === 'stay') {
    sub = `${C.esc(e.area?.label || '')} · t/m ${C.fmtShortDate(t1, e.end.tz)}`;
  } else if (e.type === 'layover') {
    sub = `tot ${C.dualTimeHTML(t1, e.end.tz)} · ${C.durationText(t1 - t0)}`;
  } else if (e.end && t1 > t0) {
    sub = `tot ${C.dualTimeHTML(t1, e.end.tz)}`;
  }
  if (e.note && e.type !== 'stay') sub += sub ? ` · ${C.esc(e.note)}` : C.esc(e.note);
  const title = e.type === 'stay' ? `Aankomst verblijf ${C.esc(e.title)}` : C.esc(C.eventTitle(e));
  const pt = C.eventPoint(e);
  return `<li class="tl-item ev ${e.type} ${st}" ${pt ? `data-lat="${pt.lat}" data-lon="${pt.lon}" data-z="${e.type === 'flight' ? 4 : 12}"` : ''} tabindex="0">
    <span class="tl-ico">${C.typeIcon(e.type)}</span>
    <div><div class="tl-time">${C.dualTimeHTML(t0, e.start.tz)}</div><div class="tl-title">${title}</div>${sub ? `<div class="tl-sub">${sub}</div>` : ''}</div></li>`;
}
function tlPost(p, now) {
  return `<li class="tl-item tl-post ${Date.parse(p.time) <= now ? 'past' : 'future'}" data-post="${p.id}" tabindex="0">
    <span class="tl-ico">${C.ICONS.post}</span>
    <div><div class="tl-time">${C.dualTimeHTML(p.time, p.tz)}</div><div class="tl-title">${C.esc(p.title)}</div>${p.loc?.label ? `<div class="tl-sub">${C.esc(p.loc.label)}</div>` : ''}</div></li>`;
}

/* ---------------- berichten ---------------- */
function renderPosts() {
  const box = $('#posts');
  S.mini.forEach((m) => m.remove()); S.mini.clear();
  if (!S.posts.length) {
    box.innerHTML = `<div class="empty card"><p><strong>Nog geen berichten.</strong></p><p>Het eerste verhaal verschijnt hier zodra de reis begint.</p></div>`;
    $('#postCount').textContent = '';
    return;
  }
  $('#postCount').textContent = `${S.posts.length} ${S.posts.length === 1 ? 'bericht' : 'berichten'}`;
  let html = '', lastDay = '';
  for (const p of S.posts) {
    const tz = p.tz || 'Asia/Bangkok';
    const d = C.ymd(p.time, tz);
    if (d !== lastDay) {
      const n = C.dayNumber(d, S.trip.dayZero);
      html += `<h3 class="day-head">${n >= 1 ? `<span>Dag ${n}</span>` : ''}${C.cap(C.fmtDayLong(new Date(d + 'T12:00:00Z'), 'UTC'))}</h3>`;
      lastDay = d;
    }
    html += postHTML(p);
  }
  box.innerHTML = html;
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); initMini(en.target); }
  }, { rootMargin: '200px' });
  $$('.mini-map', box).forEach((el) => io.observe(el));
}
function postHTML(p) {
  const tz = p.tz || 'Asia/Bangkok';
  const ex = S.exactInfo.get(p.id);
  const photos = p.photos || [];
  const gal = photos.length ? `<div class="gallery g${Math.min(photos.length, 5)}">${photos.map((ph, i) => `
      <button type="button" class="ph" data-post="${p.id}" data-i="${i}" aria-label="Foto ${i + 1} vergroten">
        <img src="${C.esc(ph.thumb || ph.src)}" alt="${C.esc(ph.caption || '')}" loading="lazy" width="${ph.tw || ''}" height="${ph.th || ''}">
      </button>`).join('')}</div>` : '';
  let locHTML = '';
  if (p.loc) {
    const coord = ex
      ? `<span class="coord exact">${C.ICONS.pin}${C.fmtCoord(ex.lat, ex.lon)}</span> <a class="fine" href="https://www.google.com/maps/search/?api=1&query=${ex.lat},${ex.lon}" target="_blank" rel="noopener">open in Google Maps</a>`
      : `<span class="coord">${C.ICONS.pin}${C.esc(p.loc.label || 'Locatie')} <span class="fine">· ≈ ${C.fmtCoord(p.loc.lat, p.loc.lon, 3)} (± ${p.loc.r >= 1000 ? (p.loc.r / 1000).toLocaleString('nl-NL') + ' km' : p.loc.r + ' m'})</span></span>`;
    locHTML = `<div class="post-loc"><div class="mini-map" data-post="${p.id}"></div><div class="loc-text">${ex ? `<span class="fine">${C.esc(p.loc.label || '')}</span><br>` : ''}${coord}</div></div>`;
  }
  const url = shareUrl(p);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${p.title} · ${S.trip.title}\n${url}`)}`;
  return `<article class="post card" id="post-${p.id}">
    <header><div class="post-meta">${C.cap(C.fmtDay(p.time, tz))} · ${C.dualTimeHTML(p.time, tz)}</div><h4>${C.esc(p.title)}</h4></header>
    ${gal}
    <div class="prose">${C.md(p.body)}</div>
    ${locHTML}
    <footer class="post-foot"><a class="btn btn-wa" href="${wa}" target="_blank" rel="noopener">${C.ICONS.share}Deel via WhatsApp</a>
    <button type="button" class="btn btn-ghost btn-sm" data-copy="${C.esc(url)}">Link kopiëren</button></footer>
  </article>`;
}
function shareUrl(p) {
  const base = (S.cfg.siteUrl || location.href.replace(/[#?].*$/, '').replace(/index\.html$/, ''));
  return `${base.replace(/\/?$/, '/')}p/${p.id}.html`;
}
function initMini(el) {
  const p = S.posts.find((x) => x.id === el.dataset.post);
  if (!p || !p.loc) return;
  const ex = S.exact.get(p.id);
  const m = L.map(el, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false });
  C.addTiles(m);
  L.circle([p.loc.lat, p.loc.lon], { radius: p.loc.r, color: C.COLORS.post, weight: 1.5, fillOpacity: 0.12 }).addTo(m);
  if (ex) {
    L.circleMarker([ex.lat, ex.lon], { radius: 7, color: '#fff', weight: 2, fillColor: C.COLORS.exact, fillOpacity: 1 }).addTo(m);
    m.setView([ex.lat, ex.lon], 15);
  } else {
    m.fitBounds(L.latLng(p.loc.lat, p.loc.lon).toBounds(p.loc.r * 2.6));
  }
  el.addEventListener('click', () => {
    document.getElementById('reis').scrollIntoView({ behavior: 'smooth' });
    const pt = ex || p.loc;
    setTimeout(() => S.map.setView([pt.lat, pt.lon], 14), 350);
  });
  el.title = 'Bekijk op de reiskaart';
  S.mini.set(p.id, m);
}

function renderAll() {
  renderHeader();
  renderLock();
  drawJourney();
  renderTimeline();
  renderPosts();
}

/* ---------------- interactie ---------------- */
function bindUI() {
  $$('.seg button').forEach((b) => b.addEventListener('click', () => fitView(b.dataset.view)));
  $('#timeline').addEventListener('click', onTimeline);
  $('#timeline').addEventListener('keydown', (e) => { if (e.key === 'Enter') onTimeline(e); });
  $('#posts').addEventListener('click', (e) => {
    const ph = e.target.closest('.ph');
    if (ph) return openLightbox(ph.dataset.post, +ph.dataset.i);
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      navigator.clipboard?.writeText(cp.dataset.copy).then(() => { cp.textContent = 'Gekopieerd'; setTimeout(() => (cp.textContent = 'Link kopiëren'), 1600); });
    }
  });
  // ontgrendelen
  const dlg = $('#unlockDlg');
  $('#lockBtn').addEventListener('click', async () => {
    if (S.key) {
      if (!confirm('Exacte locaties weer verbergen op dit apparaat?')) return;
      C.forgetKey(KEY_STORE); S.key = null; S.exact.clear(); S.exactInfo.clear(); renderAll(); return;
    }
    $('#pwErr').hidden = true; $('#pw').value = '';
    dlg.showModal(); $('#pw').focus();
  });
  $('#unlockCancel').addEventListener('click', () => dlg.close());
  $('#unlockForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#unlockGo');
    btn.disabled = true; btn.textContent = 'Controleren…';
    try {
      const key = await C.deriveKey($('#pw').value, S.meta);
      if (!(await C.verifyKey(key, S.meta))) throw new Error('fout');
      S.key = key; await C.saveKey(KEY_STORE, key, S.meta);
      await decryptAll(); dlg.close(); renderAll();
    } catch {
      $('#pwErr').textContent = 'Dat wachtwoord klopt niet.'; $('#pwErr').hidden = false;
    } finally { btn.disabled = false; btn.textContent = 'Ontgrendelen'; }
  });
  // lightbox
  const lb = $('#lightbox');
  lb.addEventListener('click', (e) => {
    if (e.target.closest('.lb-prev')) return stepLightbox(-1);
    if (e.target.closest('.lb-next')) return stepLightbox(1);
    if (e.target.closest('.lb-close') || e.target === lb) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });
  let x0 = null;
  lb.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1); x0 = null; });
}
function onTimeline(e) {
  const it = e.target.closest('.tl-item');
  if (!it) return;
  if (it.dataset.post) {
    document.getElementById(`post-${it.dataset.post}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (it.dataset.lat) {
    S.map.setView([+it.dataset.lat, +it.dataset.lon], +it.dataset.z || 11);
    if (window.innerWidth < 900) document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
let LB = null;
function openLightbox(postId, i) {
  const p = S.posts.find((x) => x.id === postId);
  if (!p) return;
  LB = { p, i };
  showLightbox();
  $('#lightbox').hidden = false;
  document.body.classList.add('no-scroll');
}
function showLightbox() {
  const ph = LB.p.photos[LB.i];
  const lb = $('#lightbox');
  $('img', lb).src = ph.src; $('img', lb).alt = ph.caption || '';
  $('figcaption', lb).textContent = ph.caption || '';
  $('.lb-prev', lb).hidden = LB.p.photos.length < 2;
  $('.lb-next', lb).hidden = LB.p.photos.length < 2;
}
function stepLightbox(d) {
  if (!LB) return;
  LB.i = (LB.i + d + LB.p.photos.length) % LB.p.photos.length;
  showLightbox();
}
function closeLightbox() { $('#lightbox').hidden = true; document.body.classList.remove('no-scroll'); LB = null; }
