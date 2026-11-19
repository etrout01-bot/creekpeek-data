// Checks partners.json and the partners/ logos before Creek Peek uses them.
// Runs on GitHub after every change to partners.json or partners/ (.github/workflows/check-partners.yml),
// or by hand: node scripts/check-partners.mjs
// A problem fails the check (a red X on the commit and an email from GitHub) and says what to fix.
// The app also checks the file itself: it skips anything wrong and keeps the last good copy.
import { readFileSync, existsSync, statSync } from 'node:fs';

const errors = [], warnings = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

let data, targets;
try { data = JSON.parse(readFileSync('partners.json', 'utf8')); }
catch (e) { console.error(`partners.json is not valid JSON: ${e.message}\nLook for a missing comma or quote near that spot.`); process.exit(1); }
try { targets = JSON.parse(readFileSync('partner-targets.json', 'utf8')); }
catch (e) { console.error('partner-targets.json is missing or broken. Get a fresh copy from Claude.'); process.exit(1); }

const KEYS = ['id', 'name', 'test', 'type', 'rivers', 'watersheds', 'start', 'end', 'logo', 'tagline', 'links', 'hatch', 'placements', 'weight', 'notes'];
const LINKS = ['shop', 'podcast', 'book', 'phone', 'directions'];
const SLOTS = ['now', 'rules', 'favorites'];
const day = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z'));
const today = new Date().toISOString().slice(0, 10);

if (!data || !Array.isArray(data.partners)) { console.error('partners.json needs { "partners": [ … ] } at the top.'); process.exit(1); }
const ids = new Set(), live = [];
data.partners.forEach((p, i) => {
  const at = `Partner ${i + 1}${p && p.id ? ` (${p.id})` : ''}`;
  if (!p || typeof p !== 'object') return fail(at, 'is not an entry in { … }');
  for (const k of Object.keys(p)) if (!KEYS.includes(k)) fail(at, `unknown field "${k}" (spelling?). Allowed: ${KEYS.join(', ')}`);
  if (typeof p.id !== 'string' || !/^[a-z0-9-]{2,60}$/.test(p.id)) fail(at, '"id" must be lower-case letters, numbers and dashes, like "brevard-fly-shop"');
  else if (ids.has(p.id)) fail(at, `"id" ${p.id} is used twice`); else ids.add(p.id);
  if (typeof p.name !== 'string' || !p.name.trim()) fail(at, '"name" is missing'); else if (p.name.length > 60) fail(at, '"name" is over 60 characters');
  if (p.test !== undefined && typeof p.test !== 'boolean') fail(at, '"test" must be true or false (no quotes)');
  if (p.type !== 'river' && p.type !== 'watershed') fail(at, '"type" must be "river" or "watershed"');
  if (p.type === 'river') {
    if (!Array.isArray(p.rivers) || !p.rivers.length) fail(at, 'a river partner needs "rivers": [ "<river id>", … ]');
    else p.rivers.forEach(r => { if (!targets.rivers[r]) fail(at, `unknown river id "${r}". Look it up in RIVER-IDS.md`); });
    if (p.watersheds !== undefined) warn(at, '"watersheds" is ignored for a river partner');
  }
  if (p.type === 'watershed') {
    if (!Array.isArray(p.watersheds) || !p.watersheds.length) fail(at, 'a watershed partner needs "watersheds": [ "<basin>", … ]');
    else p.watersheds.forEach(b => { if (!targets.basins[b]) fail(at, `unknown watershed "${b}". Use one of: ${Object.keys(targets.basins).join(', ')}`); });
    if (p.rivers !== undefined) warn(at, '"rivers" is ignored for a watershed partner');
  }
  for (const k of ['start', 'end']) if (p[k] !== undefined && !day(p[k])) fail(at, `"${k}" must be a date like "2026-12-01"`);
  if (day(p.start) && day(p.end) && p.start > p.end) fail(at, '"start" is after "end"');
  if (p.logo !== undefined) {
    if (typeof p.logo !== 'string' || !/^partners\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i.test(p.logo)) fail(at, '"logo" must look like "partners/shop-name.png" (png, jpg or webp; no spaces)');
    else if (!existsSync(p.logo)) fail(at, `logo file ${p.logo} isn't in the repository. Upload it to the partners folder (names must match exactly, capitals included)`);
    else { const kb = Math.round(statSync(p.logo).size / 1024); if (kb > 150) fail(at, `logo is ${kb} KB; keep it under 150 KB (about 400 pixels wide)`); }
  } else warn(at, 'no "logo": the app shows the shop\'s initials instead');
  if (p.tagline !== undefined && (typeof p.tagline !== 'string' || p.tagline.length > 90)) fail(at, '"tagline" must be text, 90 characters at most');
  const L = p.links || {};
  if (p.links !== undefined && (typeof p.links !== 'object' || Array.isArray(p.links))) fail(at, '"links" must be { "shop": "https://…", … }');
  for (const k of Object.keys(L)) {
    if (!LINKS.includes(k)) { fail(at, `unknown link "${k}". Allowed: ${LINKS.join(', ')}`); continue; }
    const v = L[k];
    if (k === 'phone') { if (typeof v !== 'string' || !/^[0-9+().\-\s]{7,20}$/.test(v)) fail(at, '"phone" must be a number like "828-555-0100"'); }
    else if (k === 'directions') { if (typeof v !== 'string' || !/^\s*-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/.test(v)) fail(at, '"directions" must be "latitude,longitude", like "35.2338,-82.7343" (right-click the shop in Google Maps to copy it)'); }
    else if (typeof v !== 'string' || !/^https:\/\/[^\s"'<>]+$/.test(v)) fail(at, `"${k}" must be a full web address starting with https://`);
  }
  if (p.hatch !== undefined) {
    if (!p.hatch || typeof p.hatch.text !== 'string' || !p.hatch.text.trim()) fail(at, '"hatch" needs "text"');
    else if (p.hatch.text.length > 400) fail(at, `hatch "text" is ${p.hatch.text.length} characters; keep it under 400`);
    if (p.hatch && p.hatch.updated !== undefined && !day(p.hatch.updated)) fail(at, 'hatch "updated" must be a date like "2026-11-19"');
    if (p.hatch && day(p.hatch.updated) && p.hatch.updated < new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10)) warn(at, `hatch report is from ${p.hatch.updated}, over 3 weeks old`);
  }
  const pl = p.placements;
  if (pl !== undefined) {
    if (typeof pl !== 'object' || Array.isArray(pl)) fail(at, '"placements" must be { "card": […], "hatch": […], "buttons": […] }');
    else {
      for (const k of Object.keys(pl)) if (!['card', 'hatch', 'buttons'].includes(k)) fail(at, `unknown placements field "${k}"`);
      for (const k of ['card', 'hatch']) if (pl[k] !== undefined) {
        if (!Array.isArray(pl[k])) fail(at, `placements "${k}" must be a list like ["now", "rules"]`);
        else pl[k].forEach(s => { if (!SLOTS.includes(s) || (k === 'hatch' && s === 'favorites')) fail(at, `placements "${k}" can't use "${s}". Use ${k === 'hatch' ? 'now, rules' : SLOTS.join(', ')}`); });
      }
      if (pl.buttons !== undefined) {
        if (!Array.isArray(pl.buttons)) fail(at, 'placements "buttons" must be a list like ["shop", "phone"]');
        else pl.buttons.forEach(b => { if (!LINKS.includes(b)) fail(at, `unknown button "${b}". Allowed: ${LINKS.join(', ')}`); else if (!L[b]) fail(at, `button "${b}" has no matching link in "links"`); });
      }
      if (pl.hatch && pl.hatch.length && !p.hatch) warn(at, 'placements list a hatch report but there\'s no "hatch"');
    }
  }
  if (p.weight !== undefined && !(typeof p.weight === 'number' && p.weight > 0 && p.weight <= 10)) fail(at, '"weight" must be a number from 0.1 to 10 (no quotes)');
  if (p.notes !== undefined && typeof p.notes !== 'string') fail(at, '"notes" must be text');
  if (day(p.end) && p.end < today) warn(at, `ended ${p.end}; it no longer shows. Remove it or change "end" to renew`);
  if (!errors.some(e => e.startsWith(at)) && !(day(p.end) && p.end < today) && !(day(p.start) && p.start > today)) live.push(p);
});

// A summary of who is showing where, for a quick look in the GitHub log.
const show = live.map(p => {
  const where = p.type === 'river' ? p.rivers.map(r => targets.rivers[r][0]).join('; ') : p.watersheds.map(b => `${targets.basins[b]} basin`).join('; ');
  const w = p.weight ?? (p.type === 'watershed' ? 2 : 1);
  return `  ${p.test ? '[test] ' : ''}${p.name} (${p.type}, weight ${w}): ${where}`;
});
console.log(`partners.json: ${data.partners.length} entr${data.partners.length === 1 ? 'y' : 'ies'}, ${live.length} showing today${show.length ? ':\n' + show.join('\n') : ''}`);
if (warnings.length) console.log('\nWorth a look:\n  ' + warnings.join('\n  '));
if (errors.length) { console.error('\nProblems to fix:\n  ' + errors.join('\n  ')); process.exit(1); }
console.log('\nAll good.');
