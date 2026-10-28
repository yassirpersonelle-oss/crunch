// Crunch - pure logic (no DOM, no storage). Shared by the app, the Node tests and the push function.
(function (root) {
  const MIN = 60000;

  // ---- time helpers (all local time) ----
  const pad = (n) => String(n).padStart(2, '0');
  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDate = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (key, n) => { const d = parseDate(key); d.setDate(d.getDate() + n); return dateKey(d); };
  const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };       // "07:30" -> 450
  const hmStr = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(Math.round(min) % 60)}`;
  const at = (key, minOfDay) => { const d = parseDate(key); d.setMinutes(minOfDay); return d; };
  const minOfDay = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

  // "1 h 05", "45 min", "0:18"
  const fmtDur = (min) => {
    min = Math.max(0, Math.round(min));
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)} h ${pad(min % 60)}`;
  };
  const fmtClock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  };

  // Running timer: "40:02", "60:00", "1:45:10" (minutes stay below 100 before switching to hours)
  const fmtTimer = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60);
    return m < 100 ? `${m}:${pad(s % 60)}` : fmtClock(ms);
  };

  // ---- countdown ----
  // Work hours left = the overlap of [now, release] with every wake..bed window.
  function hoursLeft(now, settings) {
    const release = new Date(settings.releaseAt);
    const clockMs = Math.max(0, release - now);
    let workMs = 0;
    let key = dateKey(now);
    while (parseDate(key) <= release) {
      const a = Math.max(at(key, hm(settings.wake)).getTime(), now.getTime());
      const b = Math.min(at(key, hm(settings.bed)).getTime(), release.getTime());
      if (b > a) workMs += b - a;
      key = addDays(key, 1);
    }
    const todayLeftMs = Math.max(0, at(dateKey(now), hm(settings.bed)) - now);
    return { clockMs, workMs, todayLeftMs };
  }

  function dayNumber(now, settings) {
    const start = parseDate(settings.startDate);
    const end = parseDate(dateKey(new Date(settings.releaseAt)));
    const n = Math.round((parseDate(dateKey(now)) - start) / 86400000) + 1;
    const total = Math.round((end - start) / 86400000) + 1;
    return { n, total };
  }

  // ---- tasks ----
  // block: {id, date, kind, title, step, plannedStart:"HH:MM"|null, expectedMin, actualMs, runningSince, doneAt, fixed, origStart}
  const actualMs = (b, now) => (b.actualMs || 0) + (b.runningSince ? now - new Date(b.runningSince) : 0);
  const isRunning = (b) => !!b.runningSince;
  const isDone = (b) => !!b.doneAt;
  const overMs = (b, now) => actualMs(b, now) - b.expectedMin * MIN;
  const onTime = (b) => isDone(b) && (b.actualMs || 0) <= b.expectedMin * MIN + 30000; // 30 s grace
  const productivity = (b) => (b.actualMs ? (b.expectedMin * MIN) / b.actualMs : 0);

  // On-time combo: consecutive on-time finishes counted back from the latest finished task today.
  function combo(blocks, date) {
    const done = blocks.filter((b) => b.date === date && b.kind === 'task' && isDone(b))
      .sort((a, b) => new Date(a.doneAt) - new Date(b.doneAt));
    let c = 0;
    for (let i = done.length - 1; i >= 0; i--) { if (onTime(done[i])) c++; else break; }
    return c;
  }

  // ---- day scoring ----
  function dayStats(date, blocks, days, settings, now) {
    const day = days[date] || {};
    const prev = days[addDays(date, -1)] || {};
    const end = day.finishedAt ? new Date(day.finishedAt) : now;
    const up = day.upAt ? new Date(day.upAt) : null;
    const awakeMin = up ? Math.max(0, (end - up) / MIN) : 0;

    const mine = blocks.filter((b) => b.date === date);
    const tasks = mine.filter((b) => b.kind === 'task');
    const workMin = tasks.reduce((s, b) => s + actualMs(b, end) / MIN, 0);
    const gymMin = mine.filter((b) => b.kind === 'gym').reduce((s, b) => s + actualMs(b, end) / MIN, 0);
    const routineMin = (day.routineMin || 0);
    const wastedMin = Math.max(0, awakeMin - workMin - gymMin - routineMin - settings.wasteAllowMin);

    const done = tasks.filter(isDone);
    const prods = done.filter((b) => b.actualMs > 0).map((b) => Math.min(1.5, productivity(b)));
    const avgProd = prods.length ? prods.reduce((a, b) => a + b, 0) / prods.length : 0;

    const sleepMin = prev.bedAt && up ? Math.max(0, (up - new Date(prev.bedAt)) / MIN) : null;
    const lateUpMin = up ? Math.max(0, (up - at(date, hm(settings.wake))) / MIN) : null;
    const lateBedMin = prev.bedAt ? Math.max(0, (new Date(prev.bedAt) - at(addDays(date, -1), hm(settings.bed))) / MIN) : null;

    // rings, 0..1 (capped)
    const work = Math.min(1, workMin / settings.workGoalMin);
    const taskRing = tasks.length ? done.length / tasks.length : 0;
    const upScore = lateUpMin == null ? 0 : lateUpMin <= 15 ? 1 : Math.max(0, 1 - (lateUpMin - 15) / 165);
    const bedScore = lateBedMin == null ? 1 : lateBedMin <= 15 ? 1 : Math.max(0, 1 - (lateBedMin - 15) / 105);
    const wasteScore = Math.max(0, 1 - wastedMin / 180);
    const discipline = (upScore + bedScore + wasteScore) / 3;

    const score = 0.4 * work + 0.35 * taskRing + 0.25 * discipline;
    // productivity = work hours vs the daily goal (can pass 100%)
    const prod = workMin / settings.workGoalMin;
    return {
      awakeMin, workMin, gymMin, routineMin, wastedMin, sleepMin, lateUpMin, lateBedMin,
      tasksDone: done.length, tasksPlanned: tasks.length, avgProd, prod,
      rings: { work, tasks: taskRing, discipline }, score, grade: grade(score),
    };
  }

  function grade(score) {
    if (score >= 0.9) return 'A';
    if (score >= 0.75) return 'B';
    if (score >= 0.6) return 'C';
    if (score >= 0.45) return 'D';
    return 'F';
  }
  const goodGrade = (g) => g === 'A' || g === 'B';
  // A day keeps the streak when productivity (work vs goal) reached 75%.
  const STREAK_MIN = 0.75;
  const dayProd = (d) => (d && d.stats && d.stats.prod != null ? d.stats.prod : null);

  // Streak = finished days in a row at B or better, counted back from today (if finished) or yesterday.
  function streak(days, today) {
    let key = days[today] && days[today].finishedAt ? today : addDays(today, -1);
    let n = 0;
    while (days[key] && days[key].finishedAt && dayProd(days[key]) >= STREAK_MIN) { n++; key = addDays(key, -1); }
    return n;
  }

  // ---- planner ripple ----
  // Timed, not-done blocks of one date. Changing block `id` by `deltaMin` (start shift or length change)
  // shifts every later non-fixed block by the same delta; fixed blocks are walls: a block that would
  // overlap a wall jumps past it. Returns a map id -> new plannedStart (minutes).
  function ripple(blocks, date, changedId, newStartMin, newLenMin) {
    const timed = blocks.filter((b) => b.date === date && b.plannedStart && !isDone(b));
    const sorted = timed.slice().sort((a, b) => hm(a.plannedStart) - hm(b.plannedStart));
    const out = {};
    const lens = {};
    for (const b of sorted) { out[b.id] = hm(b.plannedStart); lens[b.id] = b.expectedMin; }
    const changed = sorted.find((b) => b.id === changedId);
    if (!changed) return out;
    const oldEnd = out[changedId] + lens[changedId];
    out[changedId] = newStartMin;
    lens[changedId] = newLenMin;
    const delta = newStartMin + newLenMin - oldEnd;
    const walls = sorted.filter((b) => b.fixed && b.id !== changedId);
    const movers = sorted.filter((b) => !b.fixed && b.id !== changedId && hm(b.plannedStart) >= oldEnd - 1);
    let cursor = newStartMin + newLenMin;
    for (const b of movers) {
      let s = Math.max(cursor, out[b.id] + delta); // keep its offset, never overlap the previous one
      for (const w of walls) {
        const ws = out[w.id], we = ws + lens[w.id];
        if (s < we && s + lens[b.id] > ws) s = we;
      }
      out[b.id] = s;
      cursor = s + lens[b.id];
    }
    return out;
  }

  // Shift not-done timed tasks that start before `fromMin` (e.g. the morning routine ran long).
  function pushBack(blocks, date, fromMin) {
    const todo = blocks.filter((b) => b.date === date && b.plannedStart && !isDone(b) && !b.fixed)
      .sort((a, b) => hm(a.plannedStart) - hm(b.plannedStart));
    if (!todo.length || hm(todo[0].plannedStart) >= fromMin) return {};
    const delta = fromMin - hm(todo[0].plannedStart);
    const out = {};
    for (const b of todo) out[b.id] = hm(b.plannedStart) + delta;
    return out;
  }

  const api = {
    MIN, pad, dateKey, parseDate, addDays, hm, hmStr, at, minOfDay, fmtDur, fmtClock, fmtTimer,
    hoursLeft, dayNumber, actualMs, isRunning, isDone, overMs, onTime, productivity, combo,
    dayStats, grade, goodGrade, streak, dayProd, STREAK_MIN, ripple, pushBack,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof self !== 'undefined' ? self : this);
