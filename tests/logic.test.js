const L = require('../app/js/logic.js');
const assert = require('assert');
const S = { wake: '07:00', bed: '23:00', workGoalMin: 480, wasteAllowMin: 90, releaseAt: '2026-11-14T18:00', startDate: '2026-10-28' };
let ok = 0; const t = (n, f) => { f(); ok++; console.log('ok', n); };

t('hours left', () => {
  const h = L.hoursLeft(new Date(2026, 9, 28, 10, 30), S);
  // today 10:30-23:00 = 12.5h, Oct29..Nov13 = 16 days *16h = 256h, Nov14 07-18 = 11h  => 279.5h
  assert.strictEqual(h.workMs / 3600000, 279.5);
  assert.strictEqual(h.todayLeftMs / 3600000, 12.5);
  // after bedtime counts 0 for today
  assert.strictEqual(L.hoursLeft(new Date(2026, 9, 28, 23, 30), S).todayLeftMs, 0);
});
t('day number', () => assert.deepStrictEqual(L.dayNumber(new Date(2026, 9, 28, 12), S), { n: 1, total: 18 }));

const B = (id, start, len, extra = {}) => ({ id, date: '2026-10-28', kind: 'task', plannedStart: start, expectedMin: len, ...extra });
t('ripple shrink closes gap', () => {
  const bl = [B('a', '09:00', 60), B('b', '10:00', 30), B('c', '10:30', 30)];
  const r = L.ripple(bl, '2026-10-28', 'a', L.hm('09:00'), 30);
  assert.strictEqual(L.hmStr(r.b), '09:30'); assert.strictEqual(L.hmStr(r.c), '10:00');
});
t('ripple grow jumps wall', () => {
  const bl = [B('a', '16:00', 60), B('b', '17:00', 60), B('gym', '18:00', 60, { fixed: true }), B('c', '19:00', 30)];
  const r = L.ripple(bl, '2026-10-28', 'a', L.hm('16:00'), 90);
  assert.strictEqual(L.hmStr(r.b), '19:00'); // 17:30 would hit the gym wall -> after it
  assert.strictEqual(L.hmStr(r.gym), '18:00');
  assert.strictEqual(L.hmStr(r.c), '20:00');
});
t('pushBack', () => {
  const r = L.pushBack([B('a', '07:30', 30), B('b', '08:00', 30)], '2026-10-28', L.hm('07:50'));
  assert.strictEqual(L.hmStr(r.a), '07:50'); assert.strictEqual(L.hmStr(r.b), '08:20');
});
t('combo + stats + streak', () => {
  const d = (h, m) => new Date(2026, 9, 28, h, m).toISOString();
  const bl = [
    B('a', '08:00', 30, { actualMs: 25 * 60000, doneAt: d(8, 30) }),
    B('b', '09:00', 30, { actualMs: 45 * 60000, doneAt: d(9, 45) }),
    B('c', '10:00', 30, { actualMs: 30 * 60000, doneAt: d(10, 30) }),
    B('e', '11:00', 30),
  ];
  assert.strictEqual(L.combo(bl, '2026-10-28'), 1);
  const days = { '2026-10-27': { bedAt: new Date(2026, 9, 27, 23, 10).toISOString() }, '2026-10-28': { upAt: d(7, 0) } };
  const s = L.dayStats('2026-10-28', bl, days, S, new Date(2026, 9, 28, 12, 0));
  assert.strictEqual(Math.round(s.workMin), 100);
  assert.strictEqual(Math.round(s.sleepMin), 470);
  assert.strictEqual(s.tasksDone, 3);
  assert.strictEqual(Math.round(s.wastedMin), 300 - 100 - 90);
  assert.strictEqual(Math.round(s.prod * 100), Math.round(100 / S.workGoalMin * 100));
  const streakDays = { '2026-10-26': { finishedAt: 'x', stats: { prod: 0.8 } }, '2026-10-27': { finishedAt: 'x', stats: { prod: 1.1 } } };
  assert.strictEqual(L.streak(streakDays, '2026-10-28'), 2);
  streakDays['2026-10-28'] = { finishedAt: 'x', stats: { prod: 0.6 } };
  assert.strictEqual(L.streak(streakDays, '2026-10-28'), 0);
});
t('reorder keeps the slots and the walls', () => {
  const bl = [B('a', '09:00', 60), B('b', '10:00', 30), B('c', '10:30', 60), B('gym', '11:00', 60, { fixed: true }), B('d', '13:00', 30)];
  const r = L.reorder(bl, '2026-10-28', ['c', 'a', 'b']);
  assert.strictEqual(L.hmStr(r.c), '09:00');
  assert.strictEqual(L.hmStr(r.a), '10:00'); // ends exactly when the 11:00 wall starts
  assert.strictEqual(L.hmStr(r.b), '12:00'); // 11:00 would sit on the wall -> after it
  assert.strictEqual(L.hmStr(r.d), '13:00');
});
t('gym slides when not fixed', () => {
  const r = L.ripple([B('a', '16:00', 60), B('gym', '18:00', 60, { kind: 'gym' })], '2026-10-28', 'a', L.hm('16:00'), 150);
  assert.strictEqual(L.hmStr(r.gym), '19:30');
});
t('a category off "counts as work" leaves work time out', () => {
  const d = (h, m) => new Date(2026, 9, 28, h, m).toISOString();
  const bl = [B('a', '08:00', 60, { actualMs: 60 * 60000, doneAt: d(9, 0), cat: 'read' }), B('b', '09:00', 30, { actualMs: 30 * 60000, doneAt: d(9, 30), cat: 'work' })];
  const s = L.dayStats('2026-10-28', bl, { '2026-10-28': { upAt: d(7, 0) } }, { ...S, categories: [{ id: 'read', work: false }, { id: 'work', work: true }] }, new Date(2026, 9, 28, 12, 0));
  assert.strictEqual(Math.round(s.workMin), 30);
});
console.log(`${ok} passed`);
