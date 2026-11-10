// Volgt vliegtuigen live tijdens de geplande vluchttijden via de open ADS-B-netwerken
// adsb.lol en adsb.fi (geen account nodig) en bewaart de posities in data/tracks/<id>.json.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const trip = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/trip.json'), 'utf8'));
const now = Date.now();
const BEFORE = 30 * 60e3, AFTER = 90 * 60e3; // ruimte voor vertraging
const SOURCES = [
  (cs) => `https://api.adsb.lol/v2/callsign/${cs}`,
  (cs) => `https://opendata.adsb.fi/api/v2/callsign/${cs}`,
];
let changed = false;

async function lookup(cs) {
  for (const src of SOURCES) {
    try {
      const r = await fetch(src(cs), { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'reisblog-flight-tracker' } });
      if (!r.ok) { console.log(`  ${src(cs)} → ${r.status}`); continue; }
      const j = await r.json();
      const list = j.ac || j.aircraft || [];
      const a = list.find((x) => typeof x.lat === 'number' && typeof x.lon === 'number');
      if (a) return a;
      console.log(`  ${src(cs)} → niet gevonden`);
    } catch (e) { console.log(`  ${src(cs)} → ${e.message}`); }
  }
  return null;
}

for (const e of trip.events) {
  if (e.type !== 'flight' || !e.callsign) continue;
  const t0 = Date.parse(e.start.utc) - BEFORE, t1 = Date.parse(e.end.utc) + AFTER;
  if (now < t0 || now > t1) continue;
  const file = path.join(ROOT, 'data/tracks', `${e.id}.json`);
  let track = { source: 'live', points: [] };
  try { track = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (track.source === 'file') { console.log(`${e.callsign}: route uit bestand, overslaan`); continue; }
  console.log(`${e.callsign}: zoeken…`);
  const a = await lookup(e.callsign);
  if (!a) continue;
  const alt = a.alt_baro === 'ground' ? 0 : Math.round(a.alt_baro ?? a.alt_geom ?? 0);
  const ts = Math.round(now / 1000 - (a.seen_pos ?? a.seen ?? 0));
  const last = track.points[track.points.length - 1];
  if (last && (ts - last[3] < 60 || (Math.abs(last[0] - a.lat) < 0.005 && Math.abs(last[1] - a.lon) < 0.005))) { console.log('  geen nieuwe positie'); continue; }
  track.points.push([+a.lat.toFixed(4), +a.lon.toFixed(4), alt, ts]);
  track.updated = new Date(now).toISOString();
  if (a.hex) track.hex = a.hex;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(track));
  changed = true;
  console.log(`  + ${a.lat.toFixed(3)}, ${a.lon.toFixed(3)} · ${alt} ft`);
}
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
