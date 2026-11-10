import * as C from './common.js';

const KEY_STORE = 'reisblog-sleutel';
const TOKEN_STORE = 'reisblog-token';
const REPO_STORE = 'reisblog-repo';
const CACHE_STORE = 'reisblog-cache';
const A = {
  cfg: {}, gh: null, meta: null, key: null, trip: null, posts: [], stayExact: new Map(),
  tracks: {}, routes: {}, maps: {},
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* =========================================================
   GitHub
   ========================================================= */
class GH {
  constructor({ owner, repo, branch, token, apiBase }) {
    Object.assign(this, { owner, repo, branch: branch || 'main', token, base: apiBase || 'https://api.github.com' });
  }
  get r() { return `/repos/${this.owner}/${this.repo}`; }
  async req(method, path, body, accept) {
    let res;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept || 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      const err = new Error('Geen verbinding met GitHub'); err.network = true; throw err;
    }
    if (!res.ok) {
      const err = new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
      err.status = res.status; throw err;
    }
    if (accept && accept.includes('raw')) return res.text();
    return res.status === 204 ? null : res.json();
  }
  enc(path) { return path.split('/').map(encodeURIComponent).join('/'); }
  repoInfo() { return this.req('GET', this.r); }
  async headSha() { return (await this.req('GET', `${this.r}/git/ref/heads/${this.branch}`)).object.sha; }
  async readAt(path, ref) {
    try { return await this.req('GET', `${this.r}/contents/${this.enc(path)}?ref=${ref}`, null, 'application/vnd.github.raw+json'); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async listAt(path, ref) {
    try { return await this.req('GET', `${this.r}/contents/${this.enc(path)}?ref=${ref}`); }
    catch (e) { if (e.status === 404) return []; throw e; }
  }
  async blob(b64content) {
    return (await this.req('POST', `${this.r}/git/blobs`, { content: b64content, encoding: 'base64' })).sha;
  }
  async commit(parent, entries, message) {
    const head = await this.req('GET', `${this.r}/git/commits/${parent}`);
    const tree = [];
    for (const e of entries) {
      if (e.delete) tree.push({ path: e.path, mode: '100644', type: 'blob', sha: null });
      else if (e.sha) tree.push({ path: e.path, mode: '100644', type: 'blob', sha: e.sha });
      else tree.push({ path: e.path, mode: '100644', type: 'blob', content: e.content });
    }
    const t = await this.req('POST', `${this.r}/git/trees`, { base_tree: head.tree.sha, tree });
    const c = await this.req('POST', `${this.r}/git/commits`, { message, tree: t.sha, parents: [parent] });
    await this.req('PATCH', `${this.r}/git/refs/heads/${this.branch}`, { sha: c.sha, force: false });
    return c.sha;
  }
  // build(read, list) -> entries. Bij een gelijktijdige wijziging wordt alles opnieuw gelezen en geprobeerd.
  async mutate(build, message) {
    for (let attempt = 0; ; attempt++) {
      const head = await this.headSha();
      const read = async (p) => { const t = await this.readAt(p, head); return t == null ? null : JSON.parse(t); };
      const list = (p) => this.listAt(p, head);
      const entries = await build(read, list);
      try { return await this.commit(head, entries, message); }
      catch (e) { if ((e.status === 422 || e.status === 409) && attempt < 4) { await sleep(800 * (attempt + 1)); continue; } throw e; }
    }
  }
}
const jsonFile = (path, data) => ({ path, content: JSON.stringify(data, null, 1) + '\n' });

/* =========================================================
   Wachtrij (IndexedDB) voor offline posten
   ========================================================= */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('reisblog-beheer', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'qid' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('queue', mode); const st = t.objectStore('queue');
      const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx('readonly', (s) => s.getAll()); },
  put(item) { return this.tx('readwrite', (s) => s.put(item)); },
  del(qid) { return this.tx('readwrite', (s) => s.delete(qid)); },
};

/* =========================================================
   Start
   ========================================================= */
init().catch((e) => { console.error(e); toast(`Fout bij starten: ${e.message}`, true); });

async function init() {
  window.addEventListener('online', () => { updateNet(); flushQueue(); });
  window.addEventListener('offline', updateNet);
  updateNet();
  A.cfg = (await C.getJSON('config.json').catch(() => null)) || cached('cfg') || {};
  const over = JSON.parse(localStorage.getItem(REPO_STORE) || 'null') || {};
  A.repo = { owner: over.owner || A.cfg.owner, repo: over.repo || A.cfg.repo, branch: A.cfg.branch || 'main', apiBase: localStorage.getItem('reisblog-api') || undefined };
  $('#repoName').textContent = `${A.repo.owner}/${A.repo.repo}`;
  $('#owner').value = A.repo.owner || ''; $('#repo').value = A.repo.repo || '';
  bindStatic();
  const token = localStorage.getItem(TOKEN_STORE);
  if (!token) return show('login');
  A.gh = new GH({ ...A.repo, token });
  try {
    await loadRemote();
  } catch (e) {
    if (e.status === 401 || e.status === 403) { toast('De GitHub-sleutel werkt niet (meer). Log opnieuw in.', true); return show('login'); }
    const c = cached('state');
    if (!c) { toast('Geen verbinding en nog geen opgeslagen gegevens op dit apparaat.', true); return show('login'); }
    Object.assign(A, { meta: c.meta, trip: c.trip, posts: c.posts });
    toast('Offline: je kunt schrijven, berichten worden verstuurd zodra er verbinding is.');
  }
  if (!A.meta) return show('setup');
  A.key = await C.loadKey(KEY_STORE, A.meta);
  if (!A.key) return show('unlock');
  await afterUnlock();
}
async function afterUnlock() {
  await decryptStays();
  await loadGeometry();
  show('main');
  renderAll();
  flushQueue();
}
function cached(k) { try { return JSON.parse(localStorage.getItem(CACHE_STORE) || '{}')[k]; } catch { return null; } }
function cache(k, v) { try { const o = JSON.parse(localStorage.getItem(CACHE_STORE) || '{}'); o[k] = v; localStorage.setItem(CACHE_STORE, JSON.stringify(o)); } catch {} }

async function loadRemote() {
  const head = await A.gh.headSha();
  const rd = async (p) => { const t = await A.gh.readAt(p, head); return t == null ? null : JSON.parse(t); };
  const [meta, trip, posts] = await Promise.all([rd('data/crypto.json'), rd('data/trip.json'), rd('data/posts.json')]);
  A.meta = meta; A.trip = trip; A.posts = posts || [];
  cache('state', { meta, trip, posts: A.posts }); cache('cfg', A.cfg);
}
async function loadGeometry() {
  if (!navigator.onLine) return;
  await Promise.all(A.trip.events.map(async (e) => {
    try {
      if (e.type === 'flight') { const t = await C.getJSON(`data/tracks/${e.id}.json`); if (t) A.tracks[e.id] = t; }
      if (e.type === 'train' && e.route) { const r = await C.getJSON(e.route, { fresh: false }); if (r) A.routes[e.id] = r.points; }
    } catch {}
  }));
}
async function decryptStays() {
  A.stayExact.clear();
  for (const e of A.trip.events) {
    if (e.type === 'stay' && e.exact) {
      try { A.stayExact.set(e.id, await C.decryptJSON(A.key, e.exact)); } catch {}
    }
  }
}

function show(name) {
  for (const s of ['Login', 'Setup', 'Unlock', 'Main']) $(`#scr${s}`).hidden = s.toLowerCase() !== name;
  if (A.trip) $('#abarTrip').textContent = ` · ${A.trip.title}`;
}
function updateNet() {
  const el = $('#net');
  el.textContent = navigator.onLine ? 'online' : 'offline';
  el.className = `net ${navigator.onLine ? 'on' : 'off'}`;
}
let toastT;
function toast(msg, bad = false, ms = 4500) {
  const t = $('#toast');
  t.innerHTML = msg; t.className = `toast${bad ? ' bad' : ''}`; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

/* =========================================================
   Inloggen / wachtwoord
   ========================================================= */
function bindStatic() {
  $('#loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#loginErr'); err.hidden = true;
    const token = $('#token').value.trim();
    const owner = $('#owner').value.trim() || A.cfg.owner, repo = $('#repo').value.trim() || A.cfg.repo;
    const gh = new GH({ ...A.repo, owner, repo, token });
    try {
      const info = await gh.repoInfo();
      if (!info.permissions || !info.permissions.push) throw new Error('Deze sleutel heeft geen schrijfrechten op de repository.');
      localStorage.setItem(TOKEN_STORE, token);
      if (owner !== A.cfg.owner || repo !== A.cfg.repo) localStorage.setItem(REPO_STORE, JSON.stringify({ owner, repo }));
      else localStorage.removeItem(REPO_STORE);
      location.reload();
    } catch (e) {
      err.textContent = e.status === 404 ? 'Repository niet gevonden, of de sleutel heeft er geen toegang toe.' : e.status === 401 ? 'Deze sleutel is ongeldig of verlopen.' : e.message;
      err.hidden = false;
    }
  });
  $('#setupForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#setupErr'); err.hidden = true;
    const a = $('#pw1').value, b = $('#pw2').value;
    if (a !== b) { err.textContent = 'De wachtwoorden zijn niet gelijk.'; err.hidden = false; return; }
    const btn = ev.submitter; btn.disabled = true; btn.textContent = 'Bezig…';
    try {
      const { meta, key } = await C.newCryptoMeta(a);
      await A.gh.mutate(async (read) => {
        if (await read('data/crypto.json')) throw new Error('Er is al een wachtwoord ingesteld. Herlaad de pagina.');
        return [jsonFile('data/crypto.json', meta)];
      }, 'Wachtwoord voor exacte locaties ingesteld');
      A.meta = meta; A.key = key; await C.saveKey(KEY_STORE, key, meta);
      cache('state', { meta, trip: A.trip, posts: A.posts });
      toast('Wachtwoord ingesteld. Importeer nu onder <strong>Instellingen</strong> de exacte locaties van je verblijven.', false, 9000);
      await afterUnlock();
      openTab('instellingen');
    } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Wachtwoord instellen'; }
  });
  $('#unlockForm2').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('#unlockErr'); err.hidden = true;
    const btn = ev.submitter; btn.disabled = true; btn.textContent = 'Controleren…';
    const key = await C.deriveKey($('#pwU').value, A.meta);
    if (!(await C.verifyKey(key, A.meta))) { err.textContent = 'Wachtwoord klopt niet.'; err.hidden = false; btn.disabled = false; btn.textContent = 'Doorgaan'; return; }
    A.key = key; await C.saveKey(KEY_STORE, key, A.meta);
    await afterUnlock();
  });
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) openTab(b.dataset.tab); });
}
function openTab(name) {
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach((t) => { t.hidden = t.id !== `tab-${name}`; });
  if (name === 'berichten') renderPostList();
  if (name === 'tijdlijn') renderTimelineTab();
  if (name === 'vluchten') renderFlights();
  if (name === 'intro') renderIntro();
  if (name === 'instellingen') renderSettings();
  Object.values(A.maps).forEach((m) => m && setTimeout(() => m.invalidateSize(), 50));
  window.scrollTo({ top: 0 });
}
function renderAll() {
  renderEditor();
  renderQueueBox();
}

/* =========================================================
   Locaties
   ========================================================= */
function stayNear(lat, lon) {
  let best = null;
  for (const e of A.trip.events) {
    if (e.type !== 'stay' || !e.area) continue;
    const ex = A.stayExact.get(e.id);
    if (!ex) continue;
    const d = C.distance({ lat, lon }, ex);
    if (d <= C.NEAR_STAY_M && (!best || d < best.d)) best = { e, d };
  }
  return best && best.e;
}
function publicLoc(lat, lon) {
  const st = stayNear(lat, lon);
  if (st) return { lat: st.area.lat, lon: st.area.lon, r: st.area.r, kind: 'stay', stay: st.id, label: st.area.label };
  return { ...C.gridCell(lat, lon), kind: 'grid' };
}
async function reverseLabel(lat, lon) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=nl,en&lat=${lat}&lon=${lon}`, { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return '';
    const a = (await r.json()).address || {};
    const part = a.suburb || a.city_district || a.quarter || a.village || a.town || '';
    const city = a.city || a.town || a.county || a.state || '';
    const clean = (s) => s.replace(/^(Khet|Amphoe|Tambon|Khwaeng|Mueang) /i, '').replace(/ (District|Subdistrict)$/i, '');
    const p = clean(part), c = clean(city);
    return [p, c && c !== p ? c : ''].filter(Boolean).join(', ');
  } catch { return ''; }
}
function nearestCityLabel(lat, lon) {
  let best = null;
  for (const e of A.trip.events) if (e.type === 'stay' && e.area) {
    const d = C.distance({ lat, lon }, e.area);
    if (d < 40000 && (!best || d < best.d)) best = { d, label: e.title };
  }
  return best ? best.label : '';
}
function getPosition() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Locatie wordt niet ondersteund in deze browser.'));
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => rej(new Error(e.code === 1 ? 'Geen toestemming voor locatie. Sta locatie toe voor deze site.' : 'Locatie kon niet bepaald worden.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  });
}
function pickMap(el, center = [13.75, 100.5], zoom = 6) {
  const m = L.map(el, { zoomSnap: 0.5 });
  C.addTiles(m);
  m.setView(center, zoom);
  return m;
}
const exactIcon = () => L.divIcon({ className: 'xpin', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] });

/* =========================================================
   Foto's
   ========================================================= */
async function processPhoto(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`"${file.name}" kan niet gelezen worden. Gebruik JPG of PNG (iPhone: Instellingen › Camera › Formaten › Meest compatibel).`); }
  const big = await toJpeg(bmp, 1800, 0.82);
  const thumb = await toJpeg(bmp, 720, 0.78);
  bmp.close && bmp.close();
  return { big: big.blob, w: big.w, h: big.h, thumb: thumb.blob, tw: thumb.w, th: thumb.h };
}
function toJpeg(bmp, max, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, w, h);
  // Opnieuw coderen via canvas verwijdert alle EXIF-gegevens, inclusief GPS.
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res({ blob: b, w, h }) : rej(new Error('Foto verkleinen mislukt'))), 'image/jpeg', q));
}
function blobToB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
const fmtKB = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} kB`);

/* =========================================================
   Bericht schrijven / bewerken
   ========================================================= */
let ED = null;
function defaultTz() {
  const dev = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (C.TIMEZONES.includes(dev)) return dev;
  return 'Asia/Bangkok';
}
async function renderEditor(post = null) {
  if (ED?.timer) clearInterval(ED.timer);
  const box = $('#tab-nieuw');
  const tz = post?.tz || defaultTz();
  let exact = null;
  if (post?.exact) { try { exact = await C.decryptJSON(A.key, post.exact); } catch {} }
  ED = {
    mode: post ? 'edit' : 'new', id: post?.id || null, tz, timeTouched: !!post, labelTouched: !!post,
    exact, noLoc: post ? !post.loc : false, keep: post ? [...(post.photos || [])] : [], removed: [], added: [],
    when: post ? new Date(post.time) : new Date(),
  };
  box.innerHTML = `
  <div class="card editor">
    <div class="ed-head"><h2>${post ? 'Bericht bewerken' : 'Nieuw bericht'}</h2>${post ? '<button class="btn btn-sm btn-ghost" id="eCancel" type="button">Annuleren</button>' : ''}</div>
    <label class="fld">Titel<input id="eTitle" maxlength="140" placeholder="Bijvoorbeeld: Eerste nacht in Bangkok" value="${C.esc(post?.title || '')}"></label>
    <label class="fld">Tekst<textarea id="eBody" rows="9" placeholder="Wat heb je gezien, gegeten, meegemaakt?">${C.esc(post?.body || '')}</textarea>
      <span class="hint">**vet** · *cursief* · lege regel = nieuwe alinea · regels met "- " worden een lijstje</span></label>
    <div class="fld">
      <div class="flabel">Foto's</div>
      <div class="photos" id="ePhotos"></div>
      <label class="btn btn-ghost addph">+ Foto's toevoegen<input type="file" id="eFiles" accept="image/*" multiple hidden></label>
      <span class="hint">Foto's worden verkleind en locatiegegevens in de foto worden verwijderd.</span>
    </div>
    <div class="fld">
      <div class="flabel">Locatie</div>
      <div class="locbar">
        <button class="btn btn-primary btn-sm" id="eGps" type="button">${C.ICONS.pin}Gebruik mijn locatie</button>
        <input id="ePaste" placeholder="of plak coördinaten / Google Maps-link">
        <label class="chk"><input type="checkbox" id="eNoLoc" ${ED.noLoc ? 'checked' : ''}> Geen locatie</label>
      </div>
      <div class="pick-map" id="eMap"></div>
      <div class="locinfo" id="eLocInfo"></div>
      <label class="fld small">Plaatsnaam (openbaar zichtbaar)<input id="eLabel" value="${C.esc(post?.loc?.label || '')}" placeholder="wordt automatisch ingevuld"></label>
    </div>
    <div class="row2">
      <label class="fld">Tijd<input type="datetime-local" id="eTime"></label>
      <label class="fld">Tijdzone<select id="eTz">${C.TIMEZONES.map((z) => `<option value="${z}">${C.TZ_NAME[z]} (${C.TZ_SHORT[z]})</option>`).join('')}</select></label>
    </div>
    <p class="hint" id="eTimeHint"></p>
    <div class="actions">
      ${post ? '<button class="btn btn-danger" id="eDelete" type="button">Verwijderen</button>' : ''}
      <span class="grow"></span>
      <button class="btn btn-primary" id="ePublish" type="button">${post ? 'Wijzigingen opslaan' : 'Publiceren'}</button>
    </div>
  </div>
  <div id="eDone"></div>`;
  $('#eTz').value = ED.tz;
  setTimeInput();
  // kaart
  if (A.maps.editor) { A.maps.editor.remove(); A.maps.editor = null; }
  const m = pickMap($('#eMap'));
  A.maps.editor = m;
  ED.layer = L.layerGroup().addTo(m);
  m.on('click', (e) => setExact(e.latlng.lat, e.latlng.lng, null, true));
  setTimeout(() => m.invalidateSize(), 60);
  if (ED.exact) drawLoc(true); else { drawLoc(false); centerDefault(m); }
  renderPhotos();
  // events
  $('#eGps').addEventListener('click', async () => {
    const b = $('#eGps'); b.disabled = true; b.lastChild.textContent = 'Locatie bepalen…';
    try { const p = await getPosition(); setExact(p.lat, p.lon, p.acc, true); }
    catch (e) { toast(e.message, true); }
    finally { b.disabled = false; b.lastChild.textContent = 'Gebruik mijn locatie'; }
  });
  $('#ePaste').addEventListener('change', () => {
    if (!$('#ePaste').value.trim()) return;
    const c = C.parseCoords($('#ePaste').value);
    if (!c) return toast('Geen coördinaten herkend. Voorbeeld: 13.7563, 100.5018', true);
    setExact(c.lat, c.lon, null, true); $('#ePaste').value = '';
  });
  $('#eNoLoc').addEventListener('change', (e) => { ED.noLoc = e.target.checked; drawLoc(false); });
  $('#eLabel').addEventListener('input', () => { ED.labelTouched = true; });
  $('#eTime').addEventListener('change', () => { ED.timeTouched = true; readTime(); });
  $('#eTz').addEventListener('change', () => { readTime(); ED.tz = $('#eTz').value; setTimeInput(); });
  $('#eFiles').addEventListener('change', onFiles);
  $('#ePublish').addEventListener('click', onPublish);
  $('#eCancel')?.addEventListener('click', () => { renderEditor(); openTab('berichten'); });
  $('#eDelete')?.addEventListener('click', () => onDeletePost(post));
  // tijd automatisch bijhouden zolang je hem niet zelf aanpast
  ED.timer = setInterval(() => { if (!ED.timeTouched && ED.mode === 'new') { ED.when = new Date(); setTimeInput(); } }, 30000);
}
function centerDefault(m) {
  const now = Date.now();
  const cur = A.trip.events.find((e) => e.type === 'stay' && now >= Date.parse(e.start.utc) && now < Date.parse(e.end.utc));
  const st = cur || A.trip.events.find((e) => e.type === 'stay');
  if (st) m.setView([st.area.lat, st.area.lon], cur ? 13 : 6);
}
function readTime() {
  const v = $('#eTime').value;
  if (v) ED.when = C.zonedToDate(v, $('#eTz').value);
}
function setTimeInput() {
  $('#eTime').value = C.dateToZoned(ED.when, ED.tz);
  $('#eTz').value = ED.tz;
  $('#eTimeHint').innerHTML = `= ${C.dualTimeHTML(ED.when, ED.tz)} op ${C.fmtDayLong(ED.when, ED.tz)}`;
}
async function setExact(lat, lon, acc, fromUser) {
  ED.exact = { lat: +lat.toFixed(6), lon: +lon.toFixed(6), ...(acc ? { acc } : {}) };
  ED.noLoc = false; $('#eNoLoc').checked = false;
  const tz = C.tzFor(lat, lon);
  if (C.TIMEZONES.includes(tz) && tz !== ED.tz) { readTime(); ED.tz = tz; setTimeInput(); }
  drawLoc(true);
  if (fromUser && !ED.labelTouched) {
    const pl = publicLoc(lat, lon);
    if (pl.kind === 'stay') { $('#eLabel').value = pl.label; return; }
    $('#eLabel').value = nearestCityLabel(lat, lon);
    const lbl = await reverseLabel(pl.lat, pl.lon);
    if (lbl && !ED.labelTouched) $('#eLabel').value = lbl;
  }
}
function drawLoc(zoom) {
  const m = A.maps.editor; ED.layer.clearLayers();
  const info = $('#eLocInfo');
  if (ED.noLoc || !ED.exact) {
    info.innerHTML = ED.noLoc ? 'Dit bericht krijgt geen locatie.' : 'Tik op <strong>Gebruik mijn locatie</strong>, klik op de kaart of plak coördinaten.';
    return;
  }
  const { lat, lon, acc } = ED.exact;
  const pl = publicLoc(lat, lon);
  L.circle([pl.lat, pl.lon], { radius: pl.r, color: C.COLORS.post, weight: 1.5, fillOpacity: 0.1, dashArray: '4 4' }).addTo(ED.layer);
  if (acc) L.circle([lat, lon], { radius: acc, color: C.COLORS.exact, weight: 1, fillOpacity: 0.08 }).addTo(ED.layer);
  const mk = L.marker([lat, lon], { icon: exactIcon(), draggable: true }).addTo(ED.layer);
  mk.on('dragend', () => { const p = mk.getLatLng(); setExact(p.lat, p.lng, null, true); });
  if (zoom) m.setView([lat, lon], Math.max(m.getZoom(), 14));
  info.innerHTML = `<span class="pill exact">exact · alleen met wachtwoord</span> ${C.fmtCoord(lat, lon)}${acc ? ` (± ${acc} m)` : ''}<br>
    <span class="pill pub">openbaar</span> ${pl.kind === 'stay' ? `alleen de wijk van je verblijf (<strong>${C.esc(pl.label)}</strong>), want je bent binnen ${C.NEAR_STAY_M} m van je verblijf` : 'cirkel van 500 m (gestippeld), je exacte plek ligt niet in het midden'}`;
}
async function onFiles(ev) {
  const files = [...ev.target.files]; ev.target.value = '';
  for (const f of files) {
    const tmp = { pending: true, name: f.name, caption: '' };
    ED.added.push(tmp); renderPhotos();
    try { Object.assign(tmp, await processPhoto(f), { pending: false, url: null }); tmp.url = URL.createObjectURL(tmp.thumb); }
    catch (e) { ED.added.splice(ED.added.indexOf(tmp), 1); toast(e.message, true, 8000); }
    renderPhotos();
  }
}
function renderPhotos() {
  const items = [
    ...ED.keep.map((p, i) => ({ src: p.thumb || p.src, caption: p.caption || '', kind: 'keep', i })),
    ...ED.added.map((p, i) => ({ src: p.url, caption: p.caption, kind: 'add', i, pending: p.pending, size: p.big ? fmtKB(p.big.size) : '' })),
  ];
  $('#ePhotos').innerHTML = items.map((p) => `
    <div class="phx" data-kind="${p.kind}" data-i="${p.i}">
      ${p.pending ? '<div class="ph-wait">verkleinen…</div>' : `<img src="${C.esc(p.src)}" alt="">`}
      <input class="cap" placeholder="Bijschrift (optioneel)" value="${C.esc(p.caption)}">
      <div class="ph-tools">${p.size ? `<span class="fine">${p.size}</span>` : ''}<button type="button" class="mv" data-d="-1" title="Naar voren">←</button><button type="button" class="mv" data-d="1" title="Naar achteren">→</button><button type="button" class="rm" title="Verwijderen">✕</button></div>
    </div>`).join('');
  $$('#ePhotos .phx').forEach((el) => {
    const arr = el.dataset.kind === 'keep' ? ED.keep : ED.added, i = +el.dataset.i;
    $('.cap', el).addEventListener('input', (e) => { arr[i].caption = e.target.value; });
    $('.rm', el).addEventListener('click', () => { const [x] = arr.splice(i, 1); if (el.dataset.kind === 'keep') ED.removed.push(x); renderPhotos(); });
    $$('.mv', el).forEach((b) => b.addEventListener('click', () => {
      const j = i + +b.dataset.d; if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]]; renderPhotos();
    }));
  });
}
const newId = () => `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
async function onPublish() {
  const title = $('#eTitle').value.trim();
  if (!title) return toast('Geef het bericht een titel.', true);
  if (ED.added.some((p) => p.pending)) return toast('Wacht even tot de foto\'s verkleind zijn.', true);
  if (!ED.noLoc && !ED.exact && !confirm('Dit bericht heeft geen locatie. Toch publiceren?')) return;
  readTime();
  const btn = $('#ePublish'); btn.disabled = true; btn.textContent = 'Bezig…';
  try {
    const id = ED.id || newId();
    let loc = null, exact = null;
    if (!ED.noLoc && ED.exact) {
      const pl = publicLoc(ED.exact.lat, ED.exact.lon);
      loc = { ...pl, label: $('#eLabel').value.trim() || pl.label || nearestCityLabel(ED.exact.lat, ED.exact.lon) };
      exact = await C.encryptJSON(A.key, ED.exact);
    }
    const post = { id, title, body: $('#eBody').value.trim(), time: ED.when.toISOString(), tz: ED.tz, loc, exact, photos: ED.keep };
    const item = {
      qid: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, kind: ED.mode === 'edit' ? 'update' : 'create',
      post, removed: ED.removed,
      added: ED.added.map((p) => ({ big: p.big, thumb: p.thumb, caption: p.caption || '', w: p.w, h: p.h, tw: p.tw, th: p.th })),
      created: Date.now(),
    };
    await DB.put(item);
    const mode = ED.mode;
    clearInterval(ED.timer);
    await renderEditor();
    const ok = await flushQueue();
    showDone(post, mode, ok);
  } catch (e) {
    console.error(e); toast(`Opslaan mislukt: ${e.message}`, true, 8000);
    btn.disabled = false; btn.textContent = ED.mode === 'edit' ? 'Wijzigingen opslaan' : 'Publiceren';
  }
}
function showDone(post, mode, ok) {
  const url = shareUrl(post);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${post.title} · ${A.trip.title}\n${url}`)}`;
  $('#eDone').innerHTML = `<div class="card done ${ok ? '' : 'queued'}">
    <h3>${ok ? (mode === 'edit' ? 'Wijzigingen opgeslagen' : 'Gepubliceerd!') : 'Opgeslagen in de wachtrij'}</h3>
    <p>${ok ? 'Over ongeveer 1 à 2 minuten staat het online.' : 'Er is nu geen verbinding. Het bericht wordt automatisch verstuurd zodra je weer online bent (houd deze pagina dan even open).'}</p>
    <div class="actions"><a class="btn btn-wa" href="${wa}" target="_blank" rel="noopener">${C.ICONS.share}Deel via WhatsApp</a>
    <a class="btn btn-ghost btn-sm" href="./#post-${post.id}" target="_blank" rel="noopener">Bekijk op de blog</a></div></div>`;
  $('#eDone').scrollIntoView({ behavior: 'smooth' });
}
function shareUrl(post) {
  const base = A.cfg.siteUrl || location.href.replace(/[^/]*$/, '');
  return `${base.replace(/\/?$/, '/')}p/${post.id}.html`;
}
async function onDeletePost(post) {
  if (!confirm(`"${post.title}" definitief verwijderen, inclusief foto's?`)) return;
  await DB.put({ qid: `${Date.now()}-del`, kind: 'delete', post: { id: post.id, title: post.title }, removed: post.photos || [], added: [], created: Date.now() });
  clearInterval(ED.timer);
  await renderEditor();
  const ok = await flushQueue();
  toast(ok ? 'Bericht verwijderd.' : 'Verwijderen staat in de wachtrij.');
  openTab('berichten');
}

/* ---------- wachtrij versturen ---------- */
let flushing = false;
async function flushQueue() {
  if (flushing) return false;
  flushing = true;
  let items;
  try { items = await DB.all(); } catch (e) { flushing = false; throw e; }
  if (!items.length) { flushing = false; renderQueueBox(); return true; }
  if (!navigator.onLine || !A.gh) { flushing = false; renderQueueBox(); return false; }
  renderQueueBox(true);
  let allOk = true;
  items.sort((a, b) => a.created - b.created);
  for (const it of items) {
    try { await publishItem(it); await DB.del(it.qid); }
    catch (e) {
      console.error(e); allOk = false;
      if (!e.network) toast(`Versturen van "${C.esc(it.post.title)}" mislukt: ${C.esc(e.message)}`, true, 10000);
      break;
    }
  }
  flushing = false;
  renderQueueBox();
  if (!$('#tab-berichten').hidden) renderPostList();
  return allOk;
}
async function publishItem(it) {
  const post = structuredClone(it.post);
  const entries = [];
  if (it.kind !== 'delete') {
    const stamp = Date.now().toString(36);
    post.photos = [...(post.photos || [])];
    for (let i = 0; i < it.added.length; i++) {
      const p = it.added[i];
      const base = `photos/${post.id}/${stamp}-${i + 1}`;
      const [s1, s2] = await Promise.all([A.gh.blob(await blobToB64(p.big)), A.gh.blob(await blobToB64(p.thumb))]);
      entries.push({ path: `${base}.jpg`, sha: s1 }, { path: `${base}-t.jpg`, sha: s2 });
      post.photos.push({ src: `${base}.jpg`, thumb: `${base}-t.jpg`, caption: p.caption, w: p.w, h: p.h, tw: p.tw, th: p.th });
    }
  }
  const toRemove = new Set((it.removed || []).flatMap((p) => [p.src, p.thumb]).filter(Boolean));
  const msg = it.kind === 'create' ? `Bericht: ${post.title}` : it.kind === 'update' ? `Bericht bewerkt: ${post.title}` : `Bericht verwijderd: ${post.title}`;
  await A.gh.mutate(async (read, list) => {
    const posts = (await read('data/posts.json')) || [];
    const i = posts.findIndex((x) => x.id === post.id);
    if (it.kind === 'delete') { if (i >= 0) posts.splice(i, 1); }
    else if (i >= 0) posts[i] = post; else posts.push(post);
    posts.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const dels = [];
    if (toRemove.size) {
      const existing = new Set((await list(`photos/${post.id}`)).map((f) => f.path));
      for (const p of toRemove) if (existing.has(p)) dels.push({ path: p, delete: true });
    }
    A.posts = posts;
    return [...entries, ...dels, jsonFile('data/posts.json', posts)];
  }, msg);
  cache('state', { meta: A.meta, trip: A.trip, posts: A.posts });
}
async function renderQueueBox(busy = false) {
  const items = await DB.all().catch(() => []);
  const box = $('#queueBox');
  if (!items.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div><strong>${items.length} ${items.length === 1 ? 'bericht wacht' : 'berichten wachten'} op verbinding</strong><br><span class="fine">${items.map((i) => C.esc(i.post.title)).join(' · ')}</span></div>
    <button class="btn btn-sm btn-primary" id="qGo" ${busy ? 'disabled' : ''}>${busy ? 'Versturen…' : 'Nu versturen'}</button>`;
  $('#qGo').addEventListener('click', () => flushQueue());
}

/* =========================================================
   Berichtenlijst
   ========================================================= */
function renderPostList() {
  const box = $('#tab-berichten');
  const posts = [...A.posts].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  box.innerHTML = `<div class="card list">${posts.length ? posts.map((p) => `
    <div class="li">
      ${p.photos?.length ? `<img src="${C.esc(p.photos[0].thumb || p.photos[0].src)}" alt="" onerror="this.style.visibility='hidden'">` : '<div class="noimg"></div>'}
      <div class="li-main"><div class="fine">${C.fmtDay(p.time, p.tz)} · ${C.dualTimeText(p.time, p.tz)}</div><strong>${C.esc(p.title)}</strong>
      <div class="fine">${p.loc ? C.esc(p.loc.label || '') : 'geen locatie'} · ${(p.photos || []).length} foto's</div></div>
      <button class="btn btn-sm btn-ghost" data-edit="${p.id}">Bewerken</button>
    </div>`).join('') : '<p class="empty">Nog geen berichten.</p>'}</div>`;
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', async () => {
    const p = A.posts.find((x) => x.id === b.dataset.edit);
    openTab('nieuw'); await renderEditor(p);
  }));
}

/* =========================================================
   Tijdlijn
   ========================================================= */
const TYPE_NAME = { flight: 'Vlucht', train: 'Trein', stay: 'Verblijf', layover: 'Overstap', activity: 'Activiteit', other: 'Overig' };
function renderTimelineTab() {
  const box = $('#tab-tijdlijn');
  const ev = [...A.trip.events].sort((a, b) => Date.parse(a.start.utc) - Date.parse(b.start.utc));
  box.innerHTML = `<div class="card list">
    <div class="list-head"><h2>Planning</h2><button class="btn btn-sm btn-primary" id="evNew">+ Toevoegen</button></div>
    ${ev.map((e) => `<div class="li ev">
      <span class="tl-ico">${C.typeIcon(e.type)}</span>
      <div class="li-main"><div class="fine">${C.fmtDay(e.start.utc, e.start.tz)} · ${C.dualTimeText(e.start.utc, e.start.tz)} → ${C.fmtDay(e.end.utc, e.end.tz)} ${C.dualTimeText(e.end.utc, e.end.tz)}</div>
      <strong>${C.esc(C.eventTitle(e))}</strong>
      ${e.type === 'stay' ? `<div class="fine">${C.esc(e.area?.label || '')} · exacte locatie ${A.stayExact.has(e.id) ? '<span class="ok">ingesteld</span>' : '<span class="warn">ontbreekt</span>'}</div>` : ''}</div>
      <button class="btn btn-sm btn-ghost" data-ev="${e.id}">Bewerken</button></div>`).join('')}
  </div><div id="evForm"></div>`;
  $('#evNew').addEventListener('click', () => eventForm(null));
  $$('[data-ev]', box).forEach((b) => b.addEventListener('click', () => eventForm(A.trip.events.find((e) => e.id === b.dataset.ev))));
}
function eventForm(e) {
  const isNew = !e;
  const now = new Date();
  const ev = e ? structuredClone(e) : {
    id: `ev-${Math.random().toString(36).slice(2, 8)}`, type: 'activity', title: '',
    start: { utc: now.toISOString(), tz: 'Asia/Bangkok' }, end: { utc: new Date(now.getTime() + 2 * 3600e3).toISOString(), tz: 'Asia/Bangkok' },
  };
  const ex = A.stayExact.get(ev.id) || null;
  const box = $('#evForm');
  const tzSel = (id, v) => `<select id="${id}">${C.TIMEZONES.map((z) => `<option value="${z}" ${z === v ? 'selected' : ''}>${C.TZ_SHORT[z]} · ${C.TZ_NAME[z]}</option>`).join('')}</select>`;
  const pt = (pre, p) => `<div class="row3"><label class="fld small">${pre === 'from' ? 'Van' : pre === 'to' ? 'Naar' : 'Plaats'} (naam)<input id="${pre}Name" value="${C.esc(p?.name || '')}"></label>
    <label class="fld small">Breedtegraad<input id="${pre}Lat" inputmode="decimal" value="${p?.lat ?? ''}"></label><label class="fld small">Lengtegraad<input id="${pre}Lon" inputmode="decimal" value="${p?.lon ?? ''}"></label></div>`;
  box.innerHTML = `<div class="card editor">
    <div class="ed-head"><h2>${isNew ? 'Nieuw onderdeel' : 'Onderdeel bewerken'}</h2><button class="btn btn-sm btn-ghost" id="evClose">Sluiten</button></div>
    <div class="row2"><label class="fld">Soort<select id="evType" ${isNew ? '' : 'disabled'}>${Object.entries(TYPE_NAME).map(([k, v]) => `<option value="${k}" ${k === ev.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="fld">Titel<input id="evTitle" value="${C.esc(ev.title)}" placeholder="bijv. Doi Suthep bezoeken"></label></div>
    <div class="row2"><label class="fld">Begin<input type="datetime-local" id="evStart" value="${C.dateToZoned(ev.start.utc, ev.start.tz)}"></label><label class="fld">Tijdzone begin${tzSel('evStartTz', ev.start.tz)}</label></div>
    <div class="row2"><label class="fld">Einde<input type="datetime-local" id="evEnd" value="${C.dateToZoned(ev.end.utc, ev.end.tz)}"></label><label class="fld">Tijdzone einde${tzSel('evEndTz', ev.end.tz)}</label></div>
    <div data-for="flight" class="row2"><label class="fld">Vluchtnummer<input id="evFlightNo" value="${C.esc(ev.flightNo || '')}" placeholder="WY 172"></label>
      <label class="fld">Roepnaam voor live volgen<input id="evCallsign" value="${C.esc(ev.callsign || '')}" placeholder="OMA172"><span class="hint">Meestal ICAO-code + nummer (WY→OMA, QR→QTR). Staat op FlightAware/Flightradar24 bij "callsign".</span></label></div>
    <div data-for="flight train">${pt('from', ev.from)}${pt('to', ev.to)}</div>
    <div data-for="layover activity other">${pt('place', ev.place)}</div>
    <div data-for="stay">
      <div class="row3"><label class="fld small">Wijk (openbaar)<input id="arLabel" value="${C.esc(ev.area?.label || '')}"></label>
      <label class="fld small">Middelpunt wijk<input id="arPos" value="${ev.area ? C.fmtCoord(ev.area.lat, ev.area.lon) : ''}"></label>
      <label class="fld small">Straal (m)<input id="arR" inputmode="numeric" value="${ev.area?.r || 1500}"></label></div>
      <div class="row2"><label class="fld small">Exacte locatie (versleuteld)<input id="exPos" value="${ex ? C.fmtCoord(ex.lat, ex.lon, 6) : ''}" placeholder="klik op de kaart of plak coördinaten"></label>
      <label class="fld small">Adres (versleuteld)<input id="exAddr" value="${C.esc(ex?.address || '')}"></label></div>
      <button class="btn btn-sm btn-ghost" id="arAuto" type="button">Wijkgebied automatisch rond exacte locatie leggen</button>
    </div>
    <label class="fld">Notitie (openbaar)<input id="evNote" value="${C.esc(ev.note || '')}"></label>
    <div class="clickmode" id="clickMode"></div>
    <div class="pick-map" id="evMap"></div>
    <div class="actions">${isNew ? '' : '<button class="btn btn-danger" id="evDel">Verwijderen</button>'}<span class="grow"></span><button class="btn btn-primary" id="evSave">Opslaan</button></div>
  </div>`;
  if (A.maps.ev) { A.maps.ev.remove(); A.maps.ev = null; }
  const m = pickMap($('#evMap')); A.maps.ev = m;
  const lay = L.layerGroup().addTo(m);
  const typeNow = () => $('#evType').value;
  const modes = { flight: [['from', 'Van'], ['to', 'Naar']], train: [['from', 'Van'], ['to', 'Naar']], stay: [['exact', 'Exacte locatie'], ['area', 'Middelpunt wijk']], layover: [['place', 'Plaats']], activity: [['place', 'Plaats']], other: [['place', 'Plaats']] };
  let mode;
  const readPt = (pre) => { const lat = parseFloat($(`#${pre}Lat`).value), lon = parseFloat($(`#${pre}Lon`).value); return isFinite(lat) && isFinite(lon) ? { lat, lon } : null; };
  const draw = (fit) => {
    lay.clearLayers();
    const t = typeNow(); const pts = [];
    if (t === 'stay') {
      const a = C.parseCoords($('#arPos').value), x = C.parseCoords($('#exPos').value);
      if (a) { L.circle([a.lat, a.lon], { radius: +$('#arR').value || 1500, color: C.COLORS.stay, weight: 1.5, fillOpacity: 0.1 }).addTo(lay); pts.push([a.lat, a.lon]); }
      if (x) { L.marker([x.lat, x.lon], { icon: exactIcon() }).addTo(lay); pts.push([x.lat, x.lon]); }
    } else {
      for (const pre of ['from', 'to', 'place']) { const p = $(`#${pre}Lat`) && readPt(pre); if (p && $(`[data-for*="${t}"] #${pre}Lat`)) { L.circleMarker([p.lat, p.lon], { radius: 6, color: '#1d2125' }).bindTooltip(pre).addTo(lay); pts.push([p.lat, p.lon]); } }
    }
    if (fit && pts.length) pts.length > 1 ? m.fitBounds(pts, { padding: [30, 30] }) : m.setView(pts[0], 13);
  };
  const applyType = () => {
    const t = typeNow();
    $$('[data-for]', box).forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(t); });
    const ms = modes[t]; mode = ms[0][0];
    $('#clickMode').innerHTML = `<span class="fine">Klik op de kaart zet:</span> ${ms.map(([k, v], i) => `<label class="chk"><input type="radio" name="cm" value="${k}" ${i === 0 ? 'checked' : ''}> ${v}</label>`).join('')}`;
    $$('#clickMode input').forEach((r) => r.addEventListener('change', () => { mode = r.value; }));
    draw(true);
  };
  m.on('click', (ev2) => {
    const { lat, lng } = ev2.latlng;
    if (mode === 'exact') $('#exPos').value = C.fmtCoord(lat, lng, 6);
    else if (mode === 'area') $('#arPos').value = C.fmtCoord(lat, lng);
    else { $(`#${mode}Lat`).value = lat.toFixed(5); $(`#${mode}Lon`).value = lng.toFixed(5); }
    draw(false);
  });
  $$('input', box).forEach((i) => i.addEventListener('change', () => draw(false)));
  $('#evType').addEventListener('change', applyType);
  $('#evClose').addEventListener('click', () => { box.innerHTML = ''; });
  $('#arAuto').addEventListener('click', () => {
    const x = C.parseCoords($('#exPos').value);
    if (!x) return toast('Zet eerst de exacte locatie.', true);
    const p = C.offsetPoint(x.lat, x.lon, 350 + Math.random() * 450, Math.random() * 360);
    $('#arPos').value = C.fmtCoord(p.lat, p.lon, 4); if (!+$('#arR').value) $('#arR').value = 1500;
    draw(true);
  });
  $('#evDel')?.addEventListener('click', async () => {
    if (!confirm('Dit onderdeel verwijderen?')) return;
    await saveTrip(async (trip) => { trip.events = trip.events.filter((x) => x.id !== ev.id); }, `Planning: ${ev.title} verwijderd`);
    box.innerHTML = ''; renderTimelineTab();
  });
  $('#evSave').addEventListener('click', async () => {
    try {
      const t = typeNow();
      const out = { id: ev.id, type: t, title: $('#evTitle').value.trim() || TYPE_NAME[t] };
      out.start = { utc: C.zonedToDate($('#evStart').value, $('#evStartTz').value).toISOString(), tz: $('#evStartTz').value };
      out.end = { utc: C.zonedToDate($('#evEnd').value, $('#evEndTz').value).toISOString(), tz: $('#evEndTz').value };
      if (Date.parse(out.end.utc) < Date.parse(out.start.utc)) throw new Error('Het einde ligt vóór het begin.');
      const note = $('#evNote').value.trim(); if (note) out.note = note;
      const P = (pre) => { const p = readPt(pre); if (!p) return null; return { ...(ev[pre] || {}), name: $(`#${pre}Name`).value.trim(), lat: p.lat, lon: p.lon }; };
      let exactPlain = null;
      if (t === 'flight' || t === 'train') {
        out.from = P('from'); out.to = P('to');
        if (!out.from || !out.to) throw new Error('Vul van en naar in (of klik ze op de kaart).');
        if (ev.route) out.route = ev.route;
      }
      if (t === 'flight') { out.flightNo = $('#evFlightNo').value.trim(); out.callsign = $('#evCallsign').value.trim().toUpperCase().replace(/\s+/g, ''); }
      if (['layover', 'activity', 'other'].includes(t)) { const p = P('place'); if (p) out.place = p; }
      if (t === 'stay') {
        const a = C.parseCoords($('#arPos').value);
        if (!a) throw new Error('Geef het middelpunt van de wijk op.');
        out.area = { label: $('#arLabel').value.trim() || out.title, lat: +a.lat.toFixed(4), lon: +a.lon.toFixed(4), r: Math.max(800, +$('#arR').value || 1500) };
        const x = C.parseCoords($('#exPos').value);
        if (x) {
          exactPlain = { lat: x.lat, lon: x.lon, address: $('#exAddr').value.trim() };
          const d = C.distance(x, out.area);
          if (d > out.area.r) throw new Error(`De exacte locatie ligt buiten het wijkgebied (${Math.round(d)} m van het midden). Vergroot de straal of verplaats het middelpunt.`);
          if (d < 200 && !confirm('Het middelpunt van de wijk ligt erg dicht bij je exacte locatie. Toch opslaan?')) return;
          out.exact = await C.encryptJSON(A.key, exactPlain);
        } else out.exact = null;
      }
      await saveTrip(async (trip) => {
        const i = trip.events.findIndex((x) => x.id === out.id);
        if (i >= 0) trip.events[i] = out; else trip.events.push(out);
        trip.events.sort((a, b) => Date.parse(a.start.utc) - Date.parse(b.start.utc));
      }, `Planning: ${out.title}`);
      if (t === 'stay') { if (exactPlain) A.stayExact.set(out.id, exactPlain); else A.stayExact.delete(out.id); }
      toast('Opgeslagen.'); box.innerHTML = ''; renderTimelineTab();
    } catch (err) { toast(C.esc(err.message), true, 7000); }
  });
  applyType();
  setTimeout(() => { m.invalidateSize(); draw(true); }, 80);
  box.scrollIntoView({ behavior: 'smooth' });
}
async function saveTrip(mutator, message) {
  await A.gh.mutate(async (read) => {
    const trip = await read('data/trip.json');
    await mutator(trip);
    A.trip = trip;
    return [jsonFile('data/trip.json', trip)];
  }, message);
  cache('state', { meta: A.meta, trip: A.trip, posts: A.posts });
}

/* =========================================================
   Vluchten
   ========================================================= */
async function renderFlights() {
  const box = $('#tab-vluchten');
  const flights = A.trip.events.filter((e) => e.type === 'flight');
  box.innerHTML = `<div class="card editor"><h2>Vluchtroutes</h2>
    <p>Tijdens elke vlucht volgt GitHub het vliegtuig automatisch via adsb.lol (elke paar minuten). Lukt dat niet goed, download dan na de landing de tracklog bij FlightAware (knop <em>Google Earth</em>, KML-bestand) en sleep dat bestand hieronder in het vak. Een geüpload bestand vervangt de live route.</p></div>
    ${flights.map((e) => `<div class="card flight" data-id="${e.id}">
      <div class="li-main"><strong>${C.esc(C.eventTitle(e))}</strong>
      <div class="fine">${C.fmtDay(e.start.utc, e.start.tz)} · vertrek ${C.dualTimeText(e.start.utc, e.start.tz)} · roepnaam ${e.callsign ? `<code>${C.esc(e.callsign)}</code>` : '<span class="warn">ontbreekt (vul in bij Tijdlijn)</span>'}</div>
      <div class="fine trk">route laden…</div></div>
      <div class="actions">${e.callsign ? `<a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="https://www.flightaware.com/live/flight/${encodeURIComponent(e.callsign)}/history">FlightAware tracklog</a>` : ''}
      <label class="btn btn-sm btn-ghost drop">KML/GPX uploaden<input type="file" accept=".kml,.gpx,.xml,application/vnd.google-earth.kml+xml,application/gpx+xml" hidden></label>
      <button class="btn btn-sm btn-danger" data-clear hidden>Route wissen</button></div></div>`).join('')}`;
  for (const e of flights) {
    const el = $(`.flight[data-id="${e.id}"]`, box);
    const head = await A.gh.headSha().catch(() => null);
    const t = head ? await A.gh.readAt(`data/tracks/${e.id}.json`, head).catch(() => null) : null;
    const tr = t ? JSON.parse(t) : null;
    $('[data-clear]', el).hidden = !tr;
    $('.trk', el).innerHTML = tr?.points?.length ? `<span class="ok">${tr.points.length} punten</span> · bron: ${tr.source === 'file' ? 'geüpload bestand' : 'live (adsb.lol)'}` : 'nog geen echte route (de kaart toont de geplande boog)';
    const input = $('input[type=file]', el);
    const handle = async (file) => {
      try {
        const pts = parseTrack(await file.text(), e);
        if (pts.length < 2) throw new Error('Geen routepunten gevonden in dit bestand.');
        await A.gh.mutate(async () => [jsonFile(`data/tracks/${e.id}.json`, { source: 'file', points: pts })], `Vluchtroute ${e.flightNo || e.title} (bestand)`);
        toast(`Route opgeslagen (${pts.length} punten).`); renderFlights();
      } catch (err) { toast(C.esc(err.message), true, 7000); }
    };
    input.addEventListener('change', () => input.files[0] && handle(input.files[0]));
    el.addEventListener('dragover', (ev) => { ev.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (ev) => { ev.preventDefault(); el.classList.remove('over'); const f = ev.dataTransfer.files[0]; if (f) handle(f); });
    $('[data-clear]', el).addEventListener('click', async () => {
      if (!tr || !confirm('Echte route van deze vlucht wissen?')) return;
      await A.gh.mutate(async (read, list) => {
        const files = await list('data/tracks');
        return files.some((f) => f.name === `${e.id}.json`) ? [{ path: `data/tracks/${e.id}.json`, delete: true }] : [];
      }, `Vluchtroute ${e.title} gewist`);
      renderFlights();
    });
  }
}
function parseTrack(text, e) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const t0 = Date.parse(e.start.utc) / 1000, t1 = Date.parse(e.end.utc) / 1000;
  let pts = [];
  const whens = [...doc.getElementsByTagName('when')].map((w) => Date.parse(w.textContent) / 1000);
  const gx = [...doc.getElementsByTagName('gx:coord')];
  if (gx.length) {
    pts = gx.map((c, i) => { const [lon, lat, alt] = c.textContent.trim().split(/\s+/).map(Number); return [lat, lon, Math.round((alt || 0) * 3.281), whens[i] || null]; });
  } else if (doc.getElementsByTagName('trkpt').length) {
    pts = [...doc.getElementsByTagName('trkpt')].map((p) => {
      const tm = p.getElementsByTagName('time')[0], el = p.getElementsByTagName('ele')[0];
      return [+p.getAttribute('lat'), +p.getAttribute('lon'), el ? Math.round(+el.textContent * 3.281) : 0, tm ? Date.parse(tm.textContent) / 1000 : null];
    });
  } else {
    const coords = [...doc.getElementsByTagName('coordinates')].map((c) => c.textContent.trim()).sort((a, b) => b.length - a.length)[0] || '';
    pts = coords.split(/\s+/).filter(Boolean).map((s) => { const [lon, lat, alt] = s.split(',').map(Number); return [lat, lon, Math.round((alt || 0) * 3.281), null]; });
  }
  pts = pts.filter((p) => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90);
  if (pts.some((p) => p[3] == null)) pts = pts.map((p, i) => [p[0], p[1], p[2], Math.round(t0 + (t1 - t0) * (i / Math.max(1, pts.length - 1)))]);
  // hooguit ~600 punten bewaren
  const step = Math.ceil(pts.length / 600);
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => [+p[0].toFixed(4), +p[1].toFixed(4), p[2], Math.round(p[3])]);
}

/* =========================================================
   Intro
   ========================================================= */
function renderIntro() {
  const box = $('#tab-intro');
  box.innerHTML = `<div class="card editor">
    <h2>Kop en introductie</h2>
    <label class="fld">Titel<input id="inTitle" value="${C.esc(A.trip.title)}"></label>
    <label class="fld">Ondertitel<input id="inSub" value="${C.esc(A.trip.subtitle || '')}"></label>
    <label class="fld">Introtekst<textarea id="inText" rows="10">${C.esc(A.trip.intro || '')}</textarea><span class="hint">**vet** · *cursief* · lege regel = nieuwe alinea</span></label>
    <div class="flabel">Voorbeeld</div><div class="preview prose" id="inPrev"></div>
    <div class="actions"><span class="grow"></span><button class="btn btn-primary" id="inSave">Opslaan</button></div></div>`;
  const prev = () => { $('#inPrev').innerHTML = C.md($('#inText').value); };
  $('#inText').addEventListener('input', prev); prev();
  $('#inSave').addEventListener('click', async () => {
    try {
      await saveTrip(async (trip) => { trip.title = $('#inTitle').value.trim(); trip.subtitle = $('#inSub').value.trim(); trip.intro = $('#inText').value.trim(); }, 'Introductie bijgewerkt');
      toast('Opgeslagen. Over 1 à 2 minuten online.');
    } catch (e) { toast(C.esc(e.message), true); }
  });
}

/* =========================================================
   Instellingen
   ========================================================= */
function renderSettings() {
  const box = $('#tab-instellingen');
  const missing = A.trip.events.filter((e) => e.type === 'stay' && !A.stayExact.has(e.id));
  box.innerHTML = `
  <div class="card editor">
    <h2>Exacte locaties van verblijven</h2>
    ${missing.length ? `<p class="warn">Nog niet ingesteld voor: ${missing.map((e) => C.esc(`${e.title} (${C.fmtShortDate(e.start.utc, e.start.tz)})`)).join(', ')}.</p>` : '<p class="ok">Alle verblijven hebben een versleutelde exacte locatie.</p>'}
    <p>Kies het bestand <code>PRIVE-verblijven.json</code> (dat je <strong>niet</strong> naar GitHub uploadt). De adressen en coördinaten worden versleuteld opgeslagen. Controleer daarna bij <em>Tijdlijn</em> of de pins op de goede plek staan.</p>
    <label class="btn btn-ghost">Bestand kiezen<input type="file" id="stImport" accept=".json,application/json" hidden></label>
  </div>
  <div class="card editor">
    <h2>E-mail via Buttondown</h2>
    <p>Vul je Buttondown-gebruikersnaam in. Dan verschijnt op de blog een aanmeldformulier. Zet in Buttondown de RSS-functie op deze feed: <code>${C.esc((A.cfg.siteUrl || '').replace(/\/?$/, '/'))}digest.xml</code></p>
    <div class="row2"><label class="fld">Buttondown-gebruikersnaam<input id="stBd" value="${C.esc(A.cfg.buttondown || '')}" placeholder="bijv. kerbin-thailand"></label><span></span></div>
    <div class="actions"><span class="grow"></span><button class="btn btn-primary" id="stBdSave">Opslaan</button></div>
  </div>
  <div class="card editor">
    <h2>Wachtwoord wijzigen</h2>
    <p>Alle exacte locaties worden opnieuw versleuteld. Lezers moeten daarna het nieuwe wachtwoord invoeren.</p>
    <div class="row2"><label class="fld">Nieuw wachtwoord<input id="stPw1" type="password" autocomplete="new-password"></label><label class="fld">Herhaal<input id="stPw2" type="password" autocomplete="new-password"></label></div>
    <div class="actions"><span class="grow"></span><button class="btn btn-primary" id="stPwSave">Wachtwoord wijzigen</button></div>
  </div>
  <div class="card editor">
    <h2>Dit apparaat</h2>
    <p class="fine">Ingelogd op <code>${C.esc(A.gh.owner)}/${C.esc(A.gh.repo)}</code>.</p>
    <div class="actions"><button class="btn btn-danger" id="stLogout">Uitloggen op dit apparaat</button></div>
  </div>`;
  $('#stImport').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const stays = data.stays || data;
      const ids = Object.keys(stays).filter((id) => A.trip.events.some((e) => e.id === id && e.type === 'stay'));
      if (!ids.length) throw new Error('Geen verblijven in dit bestand die bij de planning passen.');
      const boxes = {};
      for (const id of ids) { const s = stays[id]; boxes[id] = await C.encryptJSON(A.key, { lat: +s.lat, lon: +s.lon, address: s.address || '' }); }
      await saveTrip(async (trip) => { for (const e of trip.events) if (boxes[e.id]) e.exact = boxes[e.id]; }, 'Exacte locaties verblijven (versleuteld)');
      for (const id of ids) A.stayExact.set(id, { lat: +stays[id].lat, lon: +stays[id].lon, address: stays[id].address || '' });
      toast(`${ids.length} verblijven versleuteld opgeslagen. Controleer de pins bij Tijdlijn.`, false, 8000);
      renderSettings();
    } catch (e) { toast(C.esc(e.message), true, 8000); }
  });
  $('#stBdSave').addEventListener('click', async () => {
    try {
      const v = $('#stBd').value.trim().replace(/^@/, '');
      await A.gh.mutate(async (read) => { const cfg = (await read('config.json')) || {}; cfg.buttondown = v; A.cfg = { ...A.cfg, buttondown: v }; return [jsonFile('config.json', cfg)]; }, 'Buttondown ingesteld');
      toast('Opgeslagen.');
    } catch (e) { toast(C.esc(e.message), true); }
  });
  $('#stPwSave').addEventListener('click', async () => {
    const a = $('#stPw1').value, b = $('#stPw2').value;
    if (a.length < 10) return toast('Kies een wachtwoord van minstens 10 tekens.', true);
    if (a !== b) return toast('De wachtwoorden zijn niet gelijk.', true);
    if (!confirm('Wachtwoord echt wijzigen?')) return;
    try {
      const { meta, key } = await C.newCryptoMeta(a);
      const re = async (box) => (box ? C.encryptJSON(key, await C.decryptJSON(A.key, box)) : box);
      await A.gh.mutate(async (read) => {
        const posts = (await read('data/posts.json')) || [], trip = await read('data/trip.json');
        for (const p of posts) p.exact = await re(p.exact);
        for (const e of trip.events) if (e.exact) e.exact = await re(e.exact);
        A.posts = posts; A.trip = trip;
        return [jsonFile('data/crypto.json', meta), jsonFile('data/posts.json', posts), jsonFile('data/trip.json', trip)];
      }, 'Wachtwoord gewijzigd (alles opnieuw versleuteld)');
      A.meta = meta; A.key = key; await C.saveKey(KEY_STORE, key, meta);
      cache('state', { meta, trip: A.trip, posts: A.posts });
      toast('Wachtwoord gewijzigd.');
      $('#stPw1').value = $('#stPw2').value = '';
    } catch (e) { toast(C.esc(e.message), true, 8000); }
  });
  $('#stLogout').addEventListener('click', () => {
    if (!confirm('Uitloggen? Je GitHub-sleutel en het wachtwoord worden van dit apparaat verwijderd.')) return;
    localStorage.removeItem(TOKEN_STORE); C.forgetKey(KEY_STORE); localStorage.removeItem(CACHE_STORE);
    location.reload();
  });
}
