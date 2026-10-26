// Creek Peek stocking helper.
// Runs once a day (GitHub Actions). Reads NC Wildlife's stocking pages and writes stocking.json,
// which the Creek Peek app reads. No libraries needed: Node 20+ and pdftotext (poppler-utils).
//
// Sources
//   1. Hatchery Supported stocking schedule (PDF, the whole season, Delayed Harvest rows marked "(DH)")
//   2. Delayed Harvest schedule page (one month at a time, CSV export)
//   3. ncpaws "Recently stocked" page (what was stocked in the last day or two)
//
// Test without the network: FIXTURES=/path/to/folder node scripts/update-stocking.mjs
//   (the folder holds hs_schedule.pdf, dh.html, dh.csv (optional) and paws.html)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUT = process.env.OUT || 'stocking.json';
const NAMES = process.env.NAMES || 'names.json';
const FIXTURES = process.env.FIXTURES || '';
const KEEP_DAYS = 90;
const UA = 'CreekPeekStockingHelper/1.0 (personal trout-flow app; once a day)';
const URLS = {
  hsPdf: 'https://ncpaws.org/PAWS/Fish/Stocking/Reports/RSReports.aspx?ReportType=Public',
  dhPage: 'https://www.ncwildlife.gov/delayed-harvest-schedule',
  paws: 'https://ncpaws.org/PAWS/Fish/Stocking/Schedule/OnlineSchedule.aspx',
};
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const MON3 = MONTHS.map(m => m.slice(0, 3));

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, { binary = false } = {}) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch (e) { last = e; await sleep(3000 * (i + 1)); }
  }
  throw new Error(`${url}: ${last.message}`);
}
const fixture = (name, binary) => {
  const p = join(FIXTURES, name);
  if (!existsSync(p)) return null;
  return binary ? readFileSync(p) : readFileSync(p, 'utf8');
};
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const strip = s => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const title = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\bMc([a-z])/g, (_, c) => 'Mc' + c.toUpperCase()).replace(/\bDh\b/g, 'DH');
const monthNum = s => { const u = s.trim().toUpperCase(); const i = MONTHS.indexOf(u); return i >= 0 ? i + 1 : MON3.indexOf(u.slice(0, 3)) + 1 || 0; };

// ncpaws.org shows a "Scheduled System Maintenance" page in place of everything during outages.
// Say so plainly instead of trying to read it as data.
function outageCheck(text) {
  if (!/Scheduled System Maintenance|Service Unavailable/i.test(text)) return;
  const when = strip((text.match(/Service Unavailable\s*-?\s*([^<]*)/i) || [])[1] || '');
  throw new Error(`ncpaws.org is down for scheduled maintenance${when ? ' (' + when + ')' : ''}`);
}

// ---------- 1. Hatchery Supported schedule (PDF) ----------
function parseSchedulePdfText(text) {
  // Line by line: a "COUNTY:" line starts a county (a page can hold several), the
  // "STREAM NAME" header sets where each month's column sits, and each row's day numbers
  // go to the month column nearest them. Long names wrap onto the next line.
  const out = [];
  let cty = '', parkway = false, year = 0, cols = null, cur = null, blankSince = true;
  for (const raw of text.split(/\n|\f/)) {
    const cm = raw.match(/COUNTY:\s*(.*?)\s{2,}YEAR:\s*(\d{4})/);
    if (cm) { parkway = /BLUE RIDGE PARKWAY/.test(cm[1]); cty = title(cm[1].replace(/^BLUE RIDGE PARKWAY\s*-\s*/, '')); year = +cm[2]; cols = null; cur = null; continue; }
    if (/STREAM NAME/.test(raw)) {
      cols = []; const re = /[A-Z]{3,}/g; let m;
      while ((m = re.exec(raw))) { const mo = monthNum(m[0]); if (mo) cols.push({ mo, c: m.index + m[0].length / 2 }); }
      cur = null; blankSince = true; continue;
    }
    if (!cols || !cols.length || !year) continue;
    if (!raw.trim()) { blankSince = true; continue; }
    if (/^\s*\d+\s+of\s+\d+\s*$/.test(raw) || !/^\S/.test(raw)) continue;
    const name = (raw.match(/^(\S.*?)(?=\s{2,}|$)/) || [])[1] || '';
    const rest = raw.slice(name.length);
    const groups = []; const g = /\d{1,2}(?:\s*,\s*\d{1,2})*/g; let k;
    while ((k = g.exec(rest))) groups.push({ at: name.length + k.index, days: k[0].split(',').map(x => +x.trim()) });
    if (!blankSince && cur && !groups.length) { cur.raw += ' ' + name.trim(); continue; }   // wrapped name
    cur = { county: cty, parkway, raw: name.trim(), dates: [] };
    for (const gr of groups) {
      const col = cols.reduce((a, b) => Math.abs(b.c - gr.at) < Math.abs(a.c - gr.at) ? b : a);
      for (const d of gr.days) if (d >= 1 && d <= 31) cur.dates.push(iso(year, col.mo, d));
    }
    out.push(cur); blankSince = false;
  }
  return out.map(r => {
    const dh = /\(DH\)/i.test(r.raw);
    const water = title(r.raw.replace(/\(DH\)/i, '').replace(/\bMDL\b/g, 'MIDDLE').replace(/\bPKWY\b/g, 'PARKWAY').replace(/\s+/g, ' ').trim());
    return { county: r.county, water, dh, parkway: r.parkway || undefined, dates: [...new Set(r.dates)].sort() };
  });
}
async function scheduleFromPdf() {
  const pdf = FIXTURES ? fixture('hs_schedule.pdf', true) : await get(URLS.hsPdf, { binary: true });
  if (!pdf || pdf.slice(0, 4).toString() !== '%PDF') { outageCheck(pdf ? pdf.toString('utf8') : ''); throw new Error('schedule is not a PDF'); }
  const dir = mkdtempSync(join(tmpdir(), 'cp-'));
  writeFileSync(join(dir, 's.pdf'), pdf);
  const text = execFileSync('pdftotext', ['-layout', join(dir, 's.pdf'), '-'], { encoding: 'utf8' });
  const rows = parseSchedulePdfText(text);
  if (rows.length < 50) throw new Error(`schedule PDF parsed to only ${rows.length} rows`);
  return rows;
}

// ---------- 2. Delayed Harvest page (one month) ----------
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
async function delayedHarvest() {
  const html = FIXTURES ? fixture('dh.html') : await get(URLS.dhPage);
  const t = strip((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const tm = t.match(/([A-Za-z]+)\s+(\d{4})\s+Delayed Harvest/i);
  if (!tm) throw new Error(`no month in page title "${t}"`);
  const mo = monthNum(tm[1]), year = +tm[2];
  let table = null;
  const csvUrl = decode((html.match(/href="([^"]+\.csv[^"]*)"/i) || [])[1] || '');
  try {
    const csv = FIXTURES ? fixture('dh.csv') : (csvUrl ? await get(csvUrl) : null);
    if (csv) table = parseCsv(csv.replace(/^﻿/, ''));
  } catch (e) { /* fall back to the page's own table */ }
  if (!table) {
    const tb = (html.match(/<table[\s\S]*?<\/table>/i) || [])[0] || '';
    table = [...tb.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(r => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => strip(c[1])));
  }
  const head = (table[0] || []).map(h => h.trim().toLowerCase());
  const ci = head.findIndex(h => h.includes('county')), si = head.findIndex(h => h.includes('stream') || h.includes('water'));
  const di = head.findIndex((h, i) => i !== ci && i !== si);
  if (ci < 0 || si < 0 || di < 0) throw new Error(`unexpected DH table columns: ${head.join(', ')}`);
  const rows = table.slice(1).map(r => ({ county: title(r[ci] || ''), water: (r[si] || '').trim(),
    dates: String(r[di] || '').split(/[,&]|\band\b/).map(x => +x.trim()).filter(d => d >= 1 && d <= 31).map(d => iso(year, mo, d)) }))
    .filter(r => r.county && r.water);
  if (!rows.length) throw new Error('DH table is empty');
  return { month: `${year}-${String(mo).padStart(2, '0')}`, source: csvUrl || URLS.dhPage, rows };
}

// ---------- 3. ncpaws recently stocked ----------
// The list only exists on days with stockings; until its layout has been seen, read any table
// in the results area, or failing that the list items, and keep the raw text too.
async function recentlyStocked() {
  const html = FIXTURES ? fixture('paws.html') : await get(URLS.paws);
  outageCheck(html);
  if (!/id="dateRangeHeading"/i.test(html)) throw new Error('daily stocking page has changed (no date heading)');
  const range = strip((html.match(/id="dateRangeHeading"[^>]*>([\s\S]*?)<\//i) || [])[1] || '');
  const rm = range.match(/([A-Za-z]+)\s+(\d{1,2})\s+thru\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  const endDate = rm ? iso(+rm[5], monthNum(rm[3]), +rm[4]) : null;
  if (/id="noStockingContainer"/i.test(html) && /no trout were stocked/i.test(html)) return { range, rows: [] };
  const main = (html.match(/id="dailyStockingMainContent"[\s\S]*?id="dailyStockingFooter"/i) || [])[0] || html;
  const rows = [];
  const tb = (main.match(/<table[\s\S]*?<\/table>/i) || [])[0];
  if (tb) {
    const trs = [...tb.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(r => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(c => strip(c[1])));
    const head = (trs[0] || []).map(h => h.toLowerCase());
    const col = re => head.findIndex(h => re.test(h));
    const ci = col(/county/), wi = col(/water|stream|location|name/), di = col(/date/);
    for (const r of trs.slice(1)) {
      if (!r.some(Boolean)) continue;
      const dm = di >= 0 ? (r[di] || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/) : null;
      rows.push({ date: dm ? iso(+dm[3], +dm[1], +dm[2]) : endDate, dateApprox: !dm || undefined,
        county: ci >= 0 ? title(r[ci]) : '', water: wi >= 0 ? r[wi] : r.join(' | '), raw: r.join(' | ') });
    }
  } else {
    for (const li of main.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) rows.push({ date: endDate, dateApprox: true, county: '', water: strip(li[1]), raw: strip(li[1]) });
  }
  return { range, rows };
}

// ---------- run ----------
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const names = existsSync(NAMES) ? JSON.parse(readFileSync(NAMES, 'utf8')) : {};
const now = new Date();
const status = {};
const run = async (key, fn) => {
  try { const v = await fn(); status[key] = { ok: true, at: now.toISOString() }; return v; }
  catch (e) { status[key] = { ok: false, at: now.toISOString(), error: String(e.message || e).slice(0, 300) }; console.error(`${key}: ${e.message}`); return undefined; }
};
const schedule = await run('schedule', scheduleFromPdf);
const dhMonth = await run('delayedHarvest', delayedHarvest);
const recent = await run('recentlyStocked', recentlyStocked);

// running history of confirmed stockings, newest first, kept 90 days
const cutoff = new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
const seen = new Set(), stocked = [];
for (const s of [...((recent && recent.rows) || []), ...(prev.stocked || [])]) {
  const k = `${s.date}|${s.county}|${s.water}`;
  if (!s.date || s.date < cutoff || seen.has(k)) continue;
  seen.add(k); stocked.push(s);
}
stocked.sort((a, b) => b.date.localeCompare(a.date));

const out = {
  version: 1,
  checked: now.toISOString(),
  updated: prev.updated,
  schedule: schedule || prev.schedule || [],
  delayedHarvest: dhMonth || prev.delayedHarvest || null,
  stocked,
  recentRange: recent ? recent.range : prev.recentRange,
  aliases: names.aliases || {},
  skip: names.skip || [],
  status,
};
const body = o => JSON.stringify({ ...o, checked: undefined, updated: undefined, status: undefined });
if (body(out) !== body(prev)) out.updated = now.toISOString();
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`schedule ${out.schedule.length} rows · DH ${out.delayedHarvest ? out.delayedHarvest.month + ' ' + out.delayedHarvest.rows.length + ' rows' : 'none'} · stocked ${stocked.length} (${(recent && recent.rows.length) || 0} new today)`);
const failed = Object.entries(status).filter(([, v]) => !v.ok).map(([k]) => k);
if (failed.length) { console.error(`failed: ${failed.join(', ')} (kept the previous data for these)`); process.exit(1); }
