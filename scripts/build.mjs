// Bouwt de site naar _site/: kopieert alle bestanden en maakt
// feed.xml (elk bericht), digest.xml (één item per dag, voor de dagelijkse mail)
// en p/<id>.html (deelpagina's met voorbeeld voor WhatsApp).
// Bepaalt ook of er gedeployd moet worden (bij geplande runs alleen als er iets veranderd is).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const OUT = path.join(ROOT, '_site');
const SKIP = new Set(['.git', '.github', 'scripts', '_site', 'node_modules', 'README.md', 'HANDLEIDING.md']);
const now = new Date(process.env.BUILD_NOW || Date.now());

const readJSON = (p, d = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return d; } };
const cfg = readJSON('config.json', {});
const trip = readJSON('data/trip.json');
const posts = (readJSON('data/posts.json', []) || []).filter((p) => Date.parse(p.time) <= now.getTime() + 6 * 3600e3);
const site = (cfg.siteUrl || '').replace(/\/?$/, '/');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (s, max = 220) => {
  const t = String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#_>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t;
};
const fmt = (d, tz, o) => new Intl.DateTimeFormat('nl-NL', { timeZone: tz, ...o }).format(new Date(d));
const time = (d, tz) => fmt(d, tz, { hour: '2-digit', minute: '2-digit' });
const dayLong = (d, tz) => fmt(d, tz, { weekday: 'long', day: 'numeric', month: 'long' });
const TZS = { 'Asia/Bangkok': 'TH', 'Asia/Muscat': 'OM', 'Asia/Qatar': 'QA', 'Europe/Amsterdam': 'NL' };
const dual = (d, tz) => (tz === 'Europe/Amsterdam' ? `${time(d, tz)} NL` : `${time(d, tz)} ${TZS[tz] || ''} (${time(d, 'Europe/Amsterdam')} NL)`);
const rfc822 = (d) => new Date(d).toUTCString();
const ymdUTC = (d) => new Date(d).toISOString().slice(0, 10);
const dayNo = (date) => Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(trip.dayZero + 'T00:00:00Z')) / 86400000) + 1;

// 1. kopiëren
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(ROOT)) {
  if (SKIP.has(f) || f.startsWith('PRIVE')) continue;
  fs.cpSync(path.join(ROOT, f), path.join(OUT, f), { recursive: true });
}

const sorted = [...posts].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
const postUrl = (p) => `${site}p/${p.id}.html`;
const firstImg = (p) => (p.photos && p.photos[0] ? site + (p.photos[0].thumb || p.photos[0].src) : '');

// 2. feed.xml – elk bericht (zonder locatie)
const items = sorted.slice(0, 60).map((p) => {
  const img = firstImg(p);
  const html = `${img ? `<p><img src="${esc(img)}" alt="" style="max-width:100%"></p>` : ''}<p>${esc(plain(p.body, 600))}</p><p><a href="${esc(postUrl(p))}">Lees verder op de blog</a></p>`;
  return `<item><title>${esc(p.title)}</title><link>${esc(postUrl(p))}</link><guid isPermaLink="false">${esc(p.id)}</guid><pubDate>${rfc822(p.time)}</pubDate><description><![CDATA[${html}]]></description></item>`;
}).join('\n');
const channel = (title, desc, link, body, file) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${esc(title)}</title><link>${esc(link)}</link><description>${esc(desc)}</description><language>nl</language>
<atom:link href="${esc(link)}${file}" rel="self" type="application/rss+xml"/>
${body}
</channel></rss>
`;
fs.writeFileSync(path.join(OUT, 'feed.xml'), channel(trip.title, trip.subtitle || 'Reisblog', site, items, 'feed.xml'));

// 3. digest.xml – één item per afgesloten dag; een dag loopt tot 21:00 Nederlandse tijd
const cutoffHourUTC = 20; // 21:00 CET
const periods = new Map();
for (const p of posts) {
  const t = Date.parse(p.time);
  const d = new Date(t);
  let end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), cutoffHourUTC);
  if (t >= end) end += 86400000;
  if (end > now.getTime()) continue; // dag nog niet afgesloten
  if (!periods.has(end)) periods.set(end, []);
  periods.get(end).push(p);
}
const digestItems = [...periods.entries()].sort((a, b) => b[0] - a[0]).slice(0, 40).map(([end, list]) => {
  list.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const date = ymdUTC(end);
  const n = dayNo(date);
  const label = dayLong(end - 3600e3, 'Europe/Amsterdam');
  const title = `${n >= 1 ? `Dag ${n} · ` : ''}${label}: ${list.length === 1 ? list[0].title : `${list.length} nieuwe berichten`}`;
  const html = list.map((p) => {
    const img = firstImg(p);
    return `<div style="margin:0 0 22px">${img ? `<a href="${esc(postUrl(p))}"><img src="${esc(img)}" alt="" style="max-width:100%;border-radius:8px"></a>` : ''}
<h3 style="margin:8px 0 2px"><a href="${esc(postUrl(p))}">${esc(p.title)}</a></h3>
<p style="margin:0 0 6px;color:#6b7079;font-size:13px">${esc(dual(p.time, p.tz || 'Asia/Bangkok'))}${p.loc && p.loc.label ? ` · ${esc(p.loc.label)}` : ''}</p>
<p style="margin:0">${esc(plain(p.body, 320))}</p></div>`;
  }).join('\n') + `<p><a href="${esc(site)}">Bekijk de kaart en alle berichten</a></p>`;
  return `<item><title>${esc(title)}</title><link>${esc(site)}#dag-${date}</link><guid isPermaLink="false">dag-${date}</guid><pubDate>${rfc822(end)}</pubDate><description><![CDATA[${html}]]></description></item>`;
}).join('\n');
fs.writeFileSync(path.join(OUT, 'digest.xml'), channel(`${trip.title} · per dag`, 'Dagelijkse samenvatting van de reisblog', site, digestItems, 'digest.xml'));

// 4. deelpagina's voor WhatsApp-voorbeelden
fs.mkdirSync(path.join(OUT, 'p'), { recursive: true });
for (const p of posts) {
  const img = firstImg(p);
  const target = `../#post-${p.id}`;
  fs.writeFileSync(path.join(OUT, 'p', `${p.id}.html`), `<!doctype html>
<html lang="nl"><head><meta charset="utf-8">
<title>${esc(p.title)} · ${esc(trip.title)}</title>
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(trip.title)}">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(plain(p.body, 180))}">
${img ? `<meta property="og:image" content="${esc(img)}">` : `<meta property="og:image" content="${esc(site)}assets/icon-512.png">`}
<meta property="og:url" content="${esc(postUrl(p))}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<link rel="canonical" href="${esc(site)}#post-${esc(p.id)}">
</head><body><p><a href="${esc(target)}">Lees “${esc(p.title)}”</a></p><script>location.replace(${JSON.stringify(target)});</script></body></html>
`);
}

// 5. hash en deploy-besluit
const hash = crypto.createHash('sha256');
const walk = (dir) => {
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (f !== 'build.json') { hash.update(path.relative(OUT, full)); hash.update(fs.readFileSync(full)); }
  }
};
walk(OUT);
const digest = hash.digest('hex').slice(0, 16);
fs.writeFileSync(path.join(OUT, 'build.json'), JSON.stringify({ hash: digest, built: now.toISOString() }));

let deploy = true;
if (process.env.EVENT === 'schedule' && site.startsWith('http')) {
  try {
    const r = await fetch(`${site}build.json?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
    if (r.ok) { const live = await r.json(); deploy = live.hash !== digest; }
  } catch { deploy = true; }
}
console.log(`build ${digest} · ${posts.length} berichten · ${periods.size} dagdigests · deploy=${deploy}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${deploy}\n`);
