// Gedeelde functies voor de blog en de beheerpagina.
export const NL_TZ = 'Europe/Amsterdam';
export const TZ_SHORT = {
  'Europe/Amsterdam': 'NL',
  'Asia/Bangkok': 'TH',
  'Asia/Muscat': 'OM',
  'Asia/Qatar': 'QA',
};
export const TZ_NAME = {
  'Europe/Amsterdam': 'Nederlandse tijd',
  'Asia/Bangkok': 'Thaise tijd',
  'Asia/Muscat': 'tijd in Oman',
  'Asia/Qatar': 'tijd in Qatar',
};
export const TIMEZONES = Object.keys(TZ_SHORT);

/* ---------- data ---------- */
export async function getJSON(path, { fresh = true } = {}) {
  const url = fresh ? `${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}` : path;
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/* ---------- tijd ---------- */
const fmtCache = new Map();
function fmt(tz, opts) {
  const k = tz + JSON.stringify(opts);
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat('nl-NL', { timeZone: tz, ...opts }));
  return fmtCache.get(k);
}
export const toDate = (v) => (v instanceof Date ? v : new Date(v));
export const fmtTime = (d, tz) => fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(toDate(d));
export const fmtDay = (d, tz) => fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }).format(toDate(d)).replace('.', '');
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtDayLong = (d, tz) => fmt(tz, { weekday: 'long', day: 'numeric', month: 'long' }).format(toDate(d));
export const fmtShortDate = (d, tz) => fmt(tz, { day: 'numeric', month: 'short' }).format(toDate(d)).replace('.', '');
export function ymd(d, tz) {
  const p = Object.fromEntries(fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(toDate(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function tzOffsetMin(d, tz) {
  const p = Object.fromEntries(fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(toDate(d)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - toDate(d).getTime()) / 60000);
}
// "2026-11-11T17:15" (wandklok in tz) -> Date
export function zonedToDate(local, tz) {
  const [dp, tp = '00:00'] = local.split('T');
  const [y, m, dd] = dp.split('-').map(Number);
  const [hh, mm] = tp.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, dd, hh, mm);
  let off = tzOffsetMin(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMin(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}
// Date -> "2026-11-11T17:15" in tz (voor datetime-local inputs)
export function dateToZoned(d, tz) {
  return `${ymd(d, tz)}T${fmtTime(d, tz)}`;
}
export function dayNumber(dateStr, dayZero) {
  const a = Date.parse(dateStr + 'T00:00:00Z');
  const b = Date.parse(dayZero + 'T00:00:00Z');
  return Math.round((a - b) / 86400000) + 1;
}
// HTML voor tijd in lokale + Nederlandse tijd
export function dualTimeHTML(d, tz) {
  d = toDate(d);
  const local = fmtTime(d, tz);
  if (!tz || tz === NL_TZ || tzOffsetMin(d, tz) === tzOffsetMin(d, NL_TZ)) {
    return `<span class="t-local">${local}</span> <span class="t-zone">NL</span>`;
  }
  const nl = fmtTime(d, NL_TZ);
  const dayDiff = ymd(d, NL_TZ) !== ymd(d, tz) ? ` <span class="t-nlday">(${fmtShortDate(d, NL_TZ)})</span>` : '';
  return `<span class="t-local">${local}</span> <span class="t-zone">${TZ_SHORT[tz] || 'lokaal'}</span><span class="t-sep">·</span><span class="t-nl">${nl} NL${dayDiff}</span>`;
}
export function dualTimeText(d, tz) {
  d = toDate(d);
  const local = fmtTime(d, tz);
  if (!tz || tz === NL_TZ) return `${local} NL`;
  return `${local} ${TZ_SHORT[tz] || 'lokaal'} (${fmtTime(d, NL_TZ)} NL)`;
}
export function durationText(ms) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60), r = m % 60;
  if (h && r) return `${h} u ${r} min`;
  if (h) return `${h} uur`;
  return `${r} min`;
}
export function tzFor(lat, lon) {
  if (lat == null || lon == null) return Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (lat > 5 && lat < 21 && lon > 97 && lon < 106) return 'Asia/Bangkok';
  if (lat > 24.4 && lat < 26.3 && lon > 50.6 && lon < 51.8) return 'Asia/Qatar';
  if (lat > 16 && lat < 27 && lon > 51.8 && lon < 60.5) return 'Asia/Muscat';
  if (lat > 50.6 && lat < 53.8 && lon > 3 && lon < 7.4) return 'Europe/Amsterdam';
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/* ---------- tekst ---------- */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
// Eenvoudige markdown: alinea's, **vet**, *cursief*, [link](url), lijstjes met "- ", kopjes met "## "
export function md(src) {
  return String(src || '').replace(/\r/g, '').split(/\n\s*\n/).map((block) => {
    const b = block.trim();
    if (!b) return '';
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*] /, ''))}</li>`).join('')}</ul>`;
    }
    const h = b.match(/^(#{2,3}) (.+)$/);
    if (h && lines.length === 1) return `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`;
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}
export function plainText(src, max = 180) {
  const t = String(src || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#_>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
}

/* ---------- versleuteling ---------- */
const te = new TextEncoder(), td = new TextDecoder();
export function b64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const CHECK_TEXT = 'reisblog-ok';

export async function newCryptoMeta(password) {
  const meta = { v: 1, kdf: 'PBKDF2-SHA256', iter: 600000, salt: b64(crypto.getRandomValues(new Uint8Array(16))) };
  const key = await deriveKey(password, meta);
  meta.check = await encryptJSON(key, CHECK_TEXT);
  return { meta, key };
}
export async function deriveKey(password, meta) {
  const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(meta.salt), iterations: meta.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function decryptJSON(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
  return JSON.parse(td.decode(pt));
}
export async function verifyKey(key, meta) {
  try { return (await decryptJSON(key, meta.check)) === CHECK_TEXT; } catch { return false; }
}
export async function saveKey(storageKey, key, meta) {
  const raw = await crypto.subtle.exportKey('raw', key);
  try { localStorage.setItem(storageKey, JSON.stringify({ salt: meta.salt, k: b64(raw) })); } catch {}
}
export async function loadKey(storageKey, meta) {
  try {
    const s = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!s || !meta || s.salt !== meta.salt) return null;
    const key = await crypto.subtle.importKey('raw', unb64(s.k), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    return (await verifyKey(key, meta)) ? key : null;
  } catch { return null; }
}
export function forgetKey(storageKey) { try { localStorage.removeItem(storageKey); } catch {} }

/* ---------- geo ---------- */
const R = 6371008.8, rad = (x) => (x * Math.PI) / 180, deg = (x) => (x * 180) / Math.PI;
export function distance(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function offsetPoint(lat, lon, dist, bearingDeg) {
  const d = dist / R, b = rad(bearingDeg), p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: deg(l2) };
}
// Vast raster van ~500 m: de exacte plek ligt altijd in de cel, maar niet in het midden.
export const GRID_M = 500;
export function gridCell(lat, lon) {
  const dLat = GRID_M / 111320;
  const latC = (Math.floor(lat / dLat) + 0.5) * dLat;
  const dLon = GRID_M / (111320 * Math.cos(rad(latC)));
  const lonC = (Math.floor(lon / dLon) + 0.5) * dLon;
  return { lat: +latC.toFixed(5), lon: +lonC.toFixed(5), r: GRID_M };
}
export const NEAR_STAY_M = 400;
export function greatCircle(a, b, n = 64) {
  const p1 = rad(a.lat), l1 = rad(a.lon), p2 = rad(b.lat), l2 = rad(b.lon);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return [[a.lat, a.lon], [b.lat, b.lon]];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))]);
  }
  return out;
}
export function fmtCoord(lat, lon, digits = 5) {
  return `${(+lat).toFixed(digits)}, ${(+lon).toFixed(digits)}`;
}
export function parseCoords(text) {
  const s = String(text || '').trim();
  let m = s.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || s.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    || s.match(/(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/* ---------- reis: planning vs werkelijk ---------- */
export const isTransport = (e) => e.type === 'flight' || e.type === 'train';
export function eventPoint(e) {
  return e.place || e.to || e.from || (e.area ? { lat: e.area.lat, lon: e.area.lon } : null);
}
// Geometrie met tijden: [[lat, lon, tMs], ...]
export function transportGeometry(e, track, routePts) {
  const t0 = Date.parse(e.start.utc), t1 = Date.parse(e.end.utc);
  const a = e.from, b = e.to;
  if (e.type === 'flight' && track && track.points && track.points.length >= 2) {
    const pts = track.points.map((p) => [p[0], p[1], p[3] * 1000]).filter((p) => p[2] >= t0 - 3600e3 && p[2] <= t1 + 3 * 3600e3);
    if (pts.length >= 2) {
      const first = pts[0], last = pts[pts.length - 1];
      return { geom: [[a.lat, a.lon, Math.min(t0, first[2] - 1)], ...pts, [b.lat, b.lon, Math.max(t1, last[2] + 1)]], actual: true };
    }
  }
  let base;
  if (e.type === 'train' && routePts && routePts.length > 1) base = routePts.map((p) => [p[0], p[1]]);
  else base = greatCircle(a, b, 80);
  // tijden verdelen naar afstand
  const cum = [0];
  for (let i = 1; i < base.length; i++) cum.push(cum[i - 1] + distance({ lat: base[i - 1][0], lon: base[i - 1][1] }, { lat: base[i][0], lon: base[i][1] }));
  const total = cum[cum.length - 1] || 1;
  return { geom: base.map((p, i) => [p[0], p[1], t0 + (t1 - t0) * (cum[i] / total)]), actual: false };
}
function splitAt(geom, now) {
  const done = [], todo = [];
  let pos = null;
  for (let i = 0; i < geom.length; i++) {
    const p = geom[i];
    if (p[2] <= now) { done.push(p); continue; }
    if (done.length && !pos) {
      const q = done[done.length - 1];
      const f = (now - q[2]) / (p[2] - q[2] || 1);
      pos = [q[0] + (p[0] - q[0]) * f, q[1] + (p[1] - q[1]) * f, now];
      done.push(pos); todo.push(pos);
    }
    todo.push(p);
  }
  return { done, todo, pos };
}
/**
 * Bouwt de kaartlagen: afgelegde route (doorgetrokken) en resterende planning (gestippeld).
 * exact: Map(id -> {lat, lon}) met ontsleutelde locaties (posts en verblijven), of leeg.
 */
export function buildJourney({ trip, posts, tracks = {}, routes = {}, now = Date.now(), exact = new Map() }) {
  const doneWaypoints = [];
  const planned = [];
  const transports = [];
  let current = null;
  for (const e of trip.events) {
    const t0 = Date.parse(e.start.utc), t1 = Date.parse(e.end.utc);
    if (isTransport(e)) {
      const { geom, actual } = transportGeometry(e, tracks[e.id], routes[e.id]);
      const { done, todo, pos } = splitAt(geom, now);
      done.forEach((p) => doneWaypoints.push({ lat: p[0], lon: p[1], t: p[2], kind: 'route' }));
      if (todo.length > 1) planned.push(todo.map((p) => [p[0], p[1]]));
      transports.push({ e, geom, actual, done: now >= t1, active: now >= t0 && now < t1 });
      if (pos && now >= t0 && now < t1) {
        let p = pos;
        const tr = tracks[e.id];
        if (e.type === 'flight' && tr && tr.points && tr.points.length) {
          const last = tr.points[tr.points.length - 1];
          if (now - last[3] * 1000 < 40 * 60000) p = [last[0], last[1], last[3] * 1000];
        }
        current = { lat: p[0], lon: p[1], type: e.type, event: e };
      }
    } else if (e.type === 'stay') {
      const pt = exact.get(e.id) || (e.area ? { lat: e.area.lat, lon: e.area.lon } : null);
      if (pt && t0 <= now) doneWaypoints.push({ lat: pt.lat, lon: pt.lon, t: t0 + 1, kind: 'stay' });
      if (pt && now >= t0 && now < t1) current = { lat: pt.lat, lon: pt.lon, type: 'stay', event: e };
    } else if (e.type === 'layover') {
      if (now >= t0 && now < t1 && e.place) current = { lat: e.place.lat, lon: e.place.lon, type: 'layover', event: e };
    }
  }
  for (const p of posts) {
    const t = Date.parse(p.time);
    const pt = exact.get(p.id) || p.loc;
    if (pt && t <= now) doneWaypoints.push({ lat: pt.lat, lon: pt.lon, t, kind: 'post' });
  }
  doneWaypoints.sort((a, b) => a.t - b.t);
  const done = doneWaypoints.map((w) => [w.lat, w.lon]);
  return { done, planned, current, transports };
}
export function currentPhase(trip, now = Date.now()) {
  const ev = trip.events;
  const start = Date.parse(ev[0].start.utc), end = Date.parse(ev[ev.length - 1].end.utc);
  if (now < start) return { phase: 'before', start, end };
  if (now >= end) return { phase: 'after', start, end };
  const active = ev.find((e) => now >= Date.parse(e.start.utc) && now < Date.parse(e.end.utc) && e.type !== 'stay')
    || ev.find((e) => now >= Date.parse(e.start.utc) && now < Date.parse(e.end.utc));
  return { phase: 'during', start, end, active };
}
export function eventTitle(e) {
  return e.type === 'flight' && e.flightNo ? `${e.flightNo} · ${e.title}` : e.title;
}

/* ---------- kaart ---------- */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export function addTiles(map) {
  return L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
}
export const COLORS = {
  done: '#c2410c', planned: '#8a8f98', stay: '#0f766e', post: '#c2410c', exact: '#7c3aed',
};

export const ICONS = {
  flight: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 21l1.5-1v-5.5l8 2.5v-2l-8-5V4.5a1.5 1.5 0 0 0-3 0V10l-8 5v2l8-2.5V20l1.5 1z" fill="currentColor"/></svg>',
  train: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-2.2 2.9L19.5 21h-2.3l-1.5-3H8.3l-1.5 3H4.5l1.7-3.1A3 3 0 0 1 4 15V6a3 3 0 0 1 3-3zm-1 4v4h12V7H6zm2.5 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" fill="currentColor"/></svg>',
  stay: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18V6h2v7h7V8h6a3 3 0 0 1 3 3v7h-2v-2H5v2H3zm5.5-6.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z" fill="currentColor"/></svg>',
  layover: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 3v5.4l3.7 2.2-1 1.7L11 13.5V7h2z" fill="currentColor"/></svg>',
  activity: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.3 5.8 21l1.6-7L2 9.2l7.1-.6L12 2z" fill="currentColor"/></svg>',
  other: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>',
  post: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5-4-4L4 16v4zm12-16l4 4 1.4-1.4a1.4 1.4 0 0 0 0-2L19.4 2.6a1.4 1.4 0 0 0-2 0L16 4z" fill="currentColor"/></svg>',
  pin: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" fill="currentColor"/></svg>',
  lock: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1zm2 0h6V7a3 3 0 0 0-6 0v3z" fill="currentColor"/></svg>',
  unlock: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 9.6-2l-1.8.9A3 3 0 0 0 9 7v3h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1z" fill="currentColor"/></svg>',
  share: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.2 13.9c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .3-3.4-.7a11.7 11.7 0 0 1-4.6-4.1c-.4-.5-1-1.6-1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.9 2.1c.1.2.1.4 0 .5l-.3.5-.4.5c-.1.1-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.6-.1l.9-1c.2-.3.4-.2.6-.1l2 1c.3.1.5.2.5.3.1.1.1.7-.1 1.3z" fill="currentColor"/></svg>',
  mail: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2.4V17h16V7.4l-8 5.3-8-5.3zM5.2 7l6.8 4.5L18.8 7H5.2z" fill="currentColor"/></svg>',
  map: '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3l6 2 6-2v16l-6 2-6-2-6 2V5l6-2zm1 2.4v12.2l4 1.3V6.7l-4-1.3z" fill="currentColor"/></svg>',
};
export const typeIcon = (t) => ICONS[t] || ICONS.other;
