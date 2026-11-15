// Stocking alerts for the Creek Peek phone app.
// Runs after update-stocking.mjs. For each stocking NC Wildlife has confirmed (stocking.json "stocked") that
// hasn't been announced yet, it finds the Creek Peek waters it belongs to (waters.json, same matching as the
// app) and sends one notification to each water's topic, "stocked-<water id>". Phones subscribe to the topics
// of their Favorites. Already-announced stockings are kept in notified.json so nothing is sent twice.
//
// Needs the GitHub secret FCM_SERVICE_ACCOUNT (the Firebase service-account JSON). Without it, or with
// DRY_RUN=1, it only prints what it would send. Never put that key in this repository: it's public.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createSign } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const read = f => JSON.parse(readFileSync(root + f, 'utf8'));
const stock = read('stocking.json');
const { waters } = read('waters.json');
const LOG = 'notified.json';
const MAX_AGE_DAYS = 3;     // only announce stockings from the last few days (never a backlog)
const KEEP_DAYS = 45;       // how long notified.json remembers a stocking

// ---- matching: the app's stockNorm / stockingFor rules ----
const stockNorm = s => String(s || '').toLowerCase().replace(/\b(rvr)\b/g, 'river').replace(/[^a-z]/g, '');
const topicFor = id => 'stocked-' + String(id).replace(/[^A-Za-z0-9\-_.~%]/g, '_');
function watersFor(row) {
  const alias = (stock.aliases || {})[`${row.county}|${row.water}`];
  let county = row.county, name = alias || row.water;
  if (name.includes('|')) [county, name] = name.split('|');   // NC Wildlife files a few waters under a neighboring county
  if ((stock.skip || []).includes(`${row.county}|${row.water}`)) return [];
  const n = stockNorm(name);
  if (/pond|lake|reservoir|parkway/.test(n)) return [];
  const dh = row.dh == null ? null : !!row.dh;
  return waters.filter(w => w.county === county && (dh == null || w.dh === dh) && (() => {
    const me = w.n;
    return n === me || (n.startsWith(me) && !/pond|lake|reservoir|parkway/.test(n.slice(me.length))) || (me.startsWith(n) && n.length >= 6);
  })());
}

// ---- dates, in North Carolina time ----
const ncToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());   // YYYY-MM-DD
const daysAgo = d => Math.round((Date.parse(ncToday()) - Date.parse(d)) / 864e5);
const when = d => { const n = daysAgo(d); return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };   // the app's wording

// ---- Firebase Cloud Messaging (HTTP v1), signed in with the service account ----
async function accessToken(sa) {
  const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }) });
  if (!res.ok) throw new Error(`Google sign-in failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}
async function send(project, token, msg) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ message: msg }) });
  if (!res.ok) throw new Error(`FCM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
function message(w, row) {
  const title = `Stocked ${when(row.date)}`;
  const body = `${w.name}: NC Wildlife confirmed a stocking${w.cls ? ` (${w.cls})` : ''}. Tap for flows and the forecast.`;
  return {
    topic: topicFor(w.id),
    notification: { title, body },
    data: { river: w.id, date: row.date },
    android: { priority: 'high', notification: { channel_id: 'stocking', tag: topicFor(w.id) } },
    apns: { headers: { 'apns-collapse-id': topicFor(w.id).slice(0, 64) }, payload: { aps: { sound: 'default', 'thread-id': 'stocking' } } }
  };
}

// ---- main ----
const keyOf = r => `${r.date}|${r.county}|${r.water}|${r.cls || ''}`;
const firstRun = !existsSync(root + LOG);
const log = firstRun ? { _about: 'Stockings already announced by stocking alerts (scripts/notify-stocking.mjs). Safe to delete entries; never edit by hand otherwise.', sent: {} } : read(LOG);
const fresh = (stock.stocked || []).filter(r => r.date && r.county && r.water && !log.sent[keyOf(r)]);

const saRaw = process.env.FCM_SERVICE_ACCOUNT;
const dry = process.env.DRY_RUN === '1' || !saRaw;
let sa = null, token = null, failures = 0, sent = 0;
if (!dry) { sa = JSON.parse(saRaw); token = await accessToken(sa); }

for (const row of fresh) {
  const age = daysAgo(row.date);
  if (firstRun || age > MAX_AGE_DAYS || age < 0) { log.sent[keyOf(row)] = { at: new Date().toISOString(), skipped: firstRun ? 'first run' : `stocked ${age} days ago` }; continue; }
  const targets = watersFor(row);
  if (!targets.length) { log.sent[keyOf(row)] = { at: new Date().toISOString(), waters: [] }; console.log(`no Creek Peek water for ${keyOf(row)}`); continue; }
  let ok = true;
  for (const w of targets) {
    const msg = message(w, row);
    if (dry) { console.log(`[dry run] ${msg.topic}: ${msg.notification.title} · ${msg.notification.body}`); continue; }
    try { await send(sa.project_id, token, msg); sent++; console.log(`sent ${msg.topic}`); }
    catch (e) { ok = false; failures++; console.error(`failed ${msg.topic}: ${e.message}`); }
  }
  // A dry run doesn't mark anything, so the real run still sends it. A failed send is retried next run.
  if (!dry && ok) log.sent[keyOf(row)] = { at: new Date().toISOString(), waters: targets.map(w => w.id) };
}
// Forget old entries so the file stays small.
for (const [k, v] of Object.entries(log.sent)) if (Date.now() - Date.parse(v.at) > KEEP_DAYS * 864e5) delete log.sent[k];
if (!dry || firstRun) writeFileSync(root + LOG, JSON.stringify(log, null, 1) + '\n');
console.log(`${dry ? 'dry run: ' : ''}${fresh.length} new confirmed stocking rows, ${sent} notifications sent${firstRun ? ' (first run: existing stockings recorded, nothing sent)' : ''}`);
if (failures) process.exit(1);
