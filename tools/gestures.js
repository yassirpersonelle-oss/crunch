// Drives the real gestures with touch input in headless Brave (demo data) and checks the result in the data.
// usage: node tools/gestures.js [outdir-for-failure-shots]
const puppeteer = require('puppeteer-core');
const path = require('path');

const BASE = 'http://127.0.0.1:8791/index.html?demo=1&reset&sim=1&at=2026-10-28T13:40';
const OUT = process.argv[2] || process.env.TEMP;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let page, pass = 0, fail = 0;

async function fresh(q = '') {
  await page.goto(BASE + q, { waitUntil: 'networkidle0' });
  await wait(1200);
}
const ev = (fn, ...a) => page.evaluate(fn, ...a);
async function center(sel) {
  const r = await ev((s) => { const el = document.querySelector(s); if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
  if (!r) throw new Error(`no element ${sel}`);
  await wait(150);
  return ev((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
}
// a finger: down, hold, move in steps, up
async function drag(from, to, { hold = 0, steps = 12, stepMs = 16 } = {}) {
  const t = page.touchscreen;
  await t.touchStart(from.x, from.y);
  if (hold) await wait(hold);
  for (let i = 1; i <= steps; i++) {
    await t.touchMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await wait(stepMs);
  }
  await wait(60);
  await t.touchEnd();
  await wait(400);
}
async function check(name, fn) {
  try { await fn(); pass++; console.log('ok  ', name); }
  catch (e) { fail++; console.log('FAIL', name, '-', e.message); await page.screenshot({ path: path.join(OUT, `fail-${name.replace(/\W+/g, '-')}.png`) }); }
}
const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const block = (title) => ev((t) => window.Store.state.blocks.find((b) => b.title === t), title);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    headless: 'new', args: ['--no-first-run', '--mute-audio', '--disable-gpu', '--hide-scrollbars'],
  });
  page = await browser.newPage();
  await page.emulate({
    viewport: { width: 414, height: 896, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack).split(/\n/).slice(0, 3).join(' | ')));

  await check('roll a duration on a row (longer + the next task slides)', async () => {
    await fresh();
    const before = await block('Car enter / exit clips'), gymBefore = await block('Gym');
    const c = await center('#upnext [data-roll-dur]');
    await drag(c, { x: c.x, y: c.y - 60 }, { hold: 260 });
    const after = await block('Car enter / exit clips');
    if (!(after.expectedMin > before.expectedMin)) throw new Error(`length ${before.expectedMin} -> ${after.expectedMin}`);
    const gym = await block('Gym');
    if (after.expectedMin + 840 > 1080 && gym.plannedStart === gymBefore.plannedStart) throw new Error('gym did not slide');
  });

  await check('roll a start time on a row', async () => {
    await fresh();
    const c = await center('#upnext [data-roll-start]');
    await drag(c, { x: c.x, y: c.y - 40 }, { hold: 260 });
    eq((await block('Car enter / exit clips')).plannedStart > '14:00', true, 'start moved later');
  });

  await check('a tap on a row still opens its menu', async () => {
    await fresh();
    const c = await center('#upnext .r-title');
    await page.touchscreen.tap(c.x, c.y); await wait(600);
    eq(await ev(() => !!document.querySelector('.actions-modal.modal-in')), true, 'menu open');
  });

  await check('swipe right finishes a task', async () => {
    await fresh();
    const c = await center('#upnext li.row .r-title');
    await drag({ x: 40, y: c.y }, { x: 400, y: c.y }, { steps: 14 });
    await wait(400);
    eq(!!(await block('Car enter / exit clips')).doneAt, true, 'done');
  });

  await check('swipe left deletes, Undo brings it back', async () => {
    await fresh();
    const c = await center('#upnext li.row .r-title');
    await drag({ x: 380, y: c.y }, { x: 10, y: c.y }, { steps: 14 });
    await wait(400);
    eq(await block('Car enter / exit clips'), undefined, 'deleted');
    const u = await center('.undo-toast .toast-button');
    await page.touchscreen.tap(u.x, u.y); await wait(500);
    eq(!!(await block('Car enter / exit clips')), true, 'back after Undo');
  });

  await check('long-press and drag reorders (times follow)', async () => {
    await fresh();
    await center('#upnext li.row:nth-child(2) .r-title');  // one scroll, then measure both rows in place
    const at = (s) => ev((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, s);
    const first = await at('#upnext li.row:nth-child(1) .r-title');
    const third = await at('#upnext li.row:nth-child(3) .r-title');
    const t1 = (await block('Weapon clips shortlist')).plannedStart;
    await drag(third, { x: third.x, y: first.y - 10 }, { hold: 600, steps: 16, stepMs: 30 });
    const t2 = (await block('Weapon clips shortlist')).plannedStart;
    if (!(t2 < t1)) throw new Error(`Weapon clips start ${t1} -> ${t2}`);
  });

  await check('fast add creates a task after the last one', async () => {
    await fresh();
    const a = await center('#qa-add');
    await page.touchscreen.tap(a.x, a.y); await wait(500);
    await page.type('#qa-t', 'Car physics tuning');
    await page.keyboard.press('Enter'); await wait(500);
    const b = await block('Car physics tuning');
    if (!b) throw new Error('not created');
    eq(b.plannedStart, '21:00', 'start'); eq(b.expectedMin, 30, 'length');
  });

  await check('hold Add a task opens the full sheet', async () => {
    await fresh();
    const a = await center('#qa-add');
    await page.touchscreen.touchStart(a.x, a.y); await wait(700); await page.touchscreen.touchEnd(); await wait(700);
    eq(await ev(() => !!document.querySelector('.task-popup.modal-in')), true, 'sheet open');
  });

  await check('the task sheet does not close on a swipe down, and keeps a draft', async () => {
    await fresh('&screen=task');
    await page.type('.task-popup [name=title]', 'Draft test');
    await drag({ x: 200, y: 200 }, { x: 200, y: 800 }, { steps: 10 });
    eq(await ev(() => !!document.querySelector('.task-popup.modal-in')), true, 'still open');
    await ev(() => document.querySelector('.task-popup .popup-close').click()); await wait(700);
    await ev(() => window.UI.taskEditor({ date: window.Store.today() })); await wait(700);
    eq(await ev(() => document.querySelector('.task-popup [name=title]').value), 'Draft test', 'draft restored');
  });

  await check('tap the timer switches to time left', async () => {
    await fresh();
    const g = await center('#g-big');
    await page.touchscreen.tap(g.x, g.y); await wait(400);
    eq(await ev(() => window.Store.state.settings.timerMode), 'left', 'mode');
    eq(await ev(() => document.querySelector('#g-sub').textContent.startsWith('left')), true, 'label');
  });

  await check('Focus opens after 20 s untouched, subtask add + tick off', async () => {
    await fresh();
    await wait(21500);
    eq(await ev(() => window.Focus.isOpen()), true, 'auto-opened');
    await page.type('#fs-t', 'Walk blend'); await page.keyboard.press('Enter'); await wait(500);
    const subs = await ev(() => window.UI.running().subs);
    eq(subs && subs.length, 1, 'one subtask');
    const c = await center('[data-sub-chk]');
    await page.touchscreen.tap(c.x, c.y); await wait(400);
    eq((await ev(() => window.UI.running().subs[0].done)) != null, true, 'ticked off');
  });

  await check('Week: swipe a block right finishes it', async () => {
    await fresh('&screen=week'); await wait(500);
    const c = await center('.blk[data-id] b');
    const id = await ev(() => { const el = document.elementFromPoint(200, 0); return null; });
    const title = await ev((y) => document.elementsFromPoint(300, y).find((e) => e.classList && e.classList.contains('blk')).querySelector('b').textContent, c.y);
    await drag({ x: 150, y: c.y }, { x: 360, y: c.y }, { steps: 12 });
    eq(!!(await block(title.replace('✓ ', ''))).doneAt, true, `${title} done`);
  });

  await check('Report saves a bug', async () => {
    await fresh();
    await ev(() => window.Support.open()); await wait(700);
    await page.type('.support-popup [name=text]', 'Test report');
    await ev(() => document.querySelector('.support-popup [data-send]').click()); await wait(500);
    eq(await ev(() => window.Store.state.feedback.length), 1, 'saved');
  });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
