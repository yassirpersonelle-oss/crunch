// Screenshots of every Crunch screen at iPhone 11 size, via headless Brave.
// usage: node tools/shots.js <outdir> [name-filter]
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const OUT = process.argv[2];
const ONLY = process.argv[3];
const BASE = 'http://127.0.0.1:8791/index.html?demo=1&reset&sim=1&at=2026-10-28T13:40';
const SHOTS = [
  { name: '01-today', q: '', wait: 1500 },
  { name: '02-today-over', q: '&demo=over', wait: 1500 },
  { name: '03-today-scrolled', q: '', wait: 1500, run: () => { document.querySelector('#view-today .page-content').scrollTop = 520; } },
  { name: '01c-theme-blue', q: '', wait: 1500, run: () => { window.Store.setKV('settings', { ...window.Store.state.settings, theme: 'blue' }); window.App.render(); }, after: 400 },
  { name: '03b-more', q: '', wait: 1500, run: () => { document.querySelector('[data-action="more"]').click(); }, after: 700 },
  { name: '04-celebrate', q: '&screen=celebrate', wait: 2000 },
  { name: '05-overrun-toast', q: '&screen=overcel', wait: 2000 },
  { name: '06-menu', q: '&screen=menu', wait: 900 },
  { name: '07-new-task', q: '&screen=task', wait: 1000 },
  { name: '08-edit-task', q: '&screen=edit', wait: 1000, run: () => { document.querySelector('[data-toggle="dur"]').click(); } },
  { name: '09-week', q: '&screen=week', wait: 1500 },
  { name: '10-plan', q: '&screen=plan', wait: 1200 },
  { name: '11-history', q: '&screen=history', wait: 1200 },
  { name: '11b-history-all', q: '&screen=history', wait: 1200, run: () => { document.querySelector('[data-metric="all"]').click(); setTimeout(() => document.querySelector('.h-chip[data-line="prod"]').click(), 200); }, after: 700 },
  { name: '12-history-scrolled', q: '&screen=history', wait: 1200, run: () => { document.querySelector('#view-history .page-content').scrollTop = 600; } },
  { name: '13-settings', q: '&screen=settings', wait: 1000 },
  { name: '14-morning', q: '&demo=fresh&at=2026-10-28T07:24&screen=morning', wait: 1000 },
  { name: '15-routine', q: '&screen=routine', wait: 900 },
  { name: '16-routine-timed', q: '&screen=routine', wait: 900, run: () => { for (let i = 0; i < 3; i++) document.querySelector('#skip').click(); } , after: 900 },
  { name: '17-reveal', q: '&at=2026-10-28T22:40&screen=reveal', wait: 7000 },
  { name: '17b-passed', q: '&at=2026-10-28T22:40&screen=passed', wait: 7000 },
  { name: '18-reveal-mid', q: '&at=2026-10-28T22:40&screen=reveal', wait: 2300 },
  { name: '19-tomorrow', q: '&at=2026-10-28T22:50&screen=tomorrow', wait: 1000 },
  { name: '20-night', q: '&at=2026-10-28T22:55&screen=night', wait: 900 },
  { name: '21-overview', q: '&demo=fresh&at=2026-10-28T07:50&screen=overview', wait: 1000 },
  // build 5
  { name: 'b5-01-upnext', q: '', wait: 1500, run: () => { document.querySelector('#view-today .page-content').scrollTop = 560; } },
  { name: 'b5-02-quickadd', q: '', wait: 1500, run: () => {
    document.querySelector('#qa-add').click();
    setTimeout(() => { const t = document.querySelector('#qa-t'); t.value = 'Car physics tuning'; t.dispatchEvent(new Event('input')); t.blur(); document.querySelector('#view-today .page-content').scrollTop = 900; }, 200);
  }, after: 900 },
  { name: 'b5-03-roll', q: '', wait: 1500, run: () => {
    document.querySelector('#view-today .page-content').scrollTop = 560;
    setTimeout(() => { const el = document.querySelector('[data-roll-dur]'); const r = el.getBoundingClientRect();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5, pointerId: 1 })); }, 200);
  }, after: 800 },
  { name: 'b5-04-swipe', q: '', wait: 1500, run: () => { document.querySelector('#view-today .page-content').scrollTop = 560; window.app.swipeout.open(document.querySelector('#upnext li.row'), 'left'); }, after: 900 },
  { name: 'b5-05-timer-left', q: '', wait: 1500, run: () => { document.querySelector('#g-big').click(); }, after: 600 },
  { name: 'b5-06-focus', q: '', wait: 1500, run: () => { window.Focus.open(); }, after: 900 },
  { name: 'b5-07-focus-subs', q: '', wait: 1500, run: () => {
    const r = window.UI.running();
    window.Store.saveBlock({ ...r, notes: 'Use the SA walk timing, not the Roblox default.', subs: [
      { id: 'a', t: 'Idle breathing loop', s: 780, d: 20, done: 798 },
      { id: 'b', t: 'Walk cycle blend', s: 800, d: 25, done: null },
      { id: 'c', t: 'Export to SAClips', s: 815, d: 30, done: null }] });
    window.Focus.open(); setTimeout(() => { document.querySelector('#focus').scrollTop = 900; }, 400);
  }, after: 1100 },
  { name: 'b5-08-sheet', q: '&screen=task', wait: 1200 },
  { name: 'b5-09-settings-cats', q: '&screen=settings', wait: 1000, run: () => { const pc = document.querySelector('#settings-body'); pc.scrollTop = pc.scrollHeight; }, after: 600 },
  { name: 'b5-10-support', q: '', wait: 1500, run: () => { window.Support.open(); }, after: 900 },
  { name: 'b5-11-week', q: '&screen=week', wait: 1500 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    headless: 'new', args: ['--no-first-run', '--mute-audio', '--disable-gpu', '--hide-scrollbars'],
    userDataDir: path.join(process.env.TEMP, 'crunch-pptr'),
  });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.emulate({
    viewport: { width: 414, height: 896, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[${cur}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${cur}] ${m.text()}`); });
  let cur = '';
  for (const s of SHOTS) {
    if (ONLY && !s.name.includes(ONLY)) continue;
    cur = s.name;
    const u = new URL(BASE); new URLSearchParams(s.q.replace(/^&/, '')).forEach((v, k) => u.searchParams.set(k, v));
    await page.goto(u.toString(), { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise((r) => setTimeout(r, s.wait));
    if (s.run) { await page.evaluate(s.run); await new Promise((r) => setTimeout(r, s.after || 500)); }
    await page.screenshot({ path: path.join(OUT, s.name + '.png') });
    console.log('shot', s.name);
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
})().catch((e) => { console.error(e); process.exit(1); });
