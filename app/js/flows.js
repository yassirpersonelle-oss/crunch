// Crunch - full-screen guided flows: morning (up -> routine -> overview -> start) and
// evening (finish -> reveal -> night routine -> plan tomorrow -> bed).
(function () {
  const L = window.Logic, Store = window.Store, S = Store.state, UI = window.UI, { Sound, flameSVG } = window.FX;
  const root = () => document.getElementById('flow');
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  let picker = null;

  function show(html) {
    clearTimers();
    if (picker) { picker.destroy(); picker = null; }
    const r = root(); r.hidden = false;
    r.innerHTML = `<div class="fl enter">${html}</div>`;
    return r.firstElementChild;
  }
  function close() { clearTimers(); if (picker) { picker.destroy(); picker = null; } root().hidden = true; root().innerHTML = ''; window.App.render(); }
  const dots = (i, n) => `<div class="dots">${Array.from({ length: n }, (_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>`;

  // ---------- shared: one routine item per screen ----------
  function routine(kind, onEnd) {
    const items = S.routines[kind].filter((x) => x.title);
    const t0 = Store.now();
    let i = 0;
    const next = () => {
      if (i >= items.length) { onEnd((Store.now() - t0) / L.MIN); return; }
      const it = items[i];
      const el = show(`
        <div class="fl-top"><span>${kind === 'morning' ? 'Morning routine' : 'Night routine'}</span>${dots(i, items.length)}</div>
        <div class="fl-center">
          <div class="routine-title">${UI.esc(it.title)}</div>
          
          <div class="bigcheck ${it.min ? 'timed' : ''}" id="bc">
            <svg class="ring" viewBox="0 0 160 160"><circle class="cd-track" cx="80" cy="80" r="74"/>${it.min ? `<circle class="cd" id="cd" cx="80" cy="80" r="74" stroke-dasharray="${2 * Math.PI * 74}" stroke-dashoffset="0"/>` : ''}</svg>
            ${it.min ? '<div class="cd-time num" id="cdt"></div>' : '<i class="f7-icons bc-glyph">checkmark_alt</i>'}
            <div class="tick"><svg viewBox="0 0 112 112"><path d="M36 58 L50 72 L77 42"/></svg></div>
          </div>
          <div class="bc-hint">${it.min ? 'Tap when done' : 'Tap to check'}</div>
        </div>
        <div class="fl-bottom"><div class="fl-skip" id="skip">Skip</div></div>`);
      const shownAt = Date.now();
      if (it.min) {
        const C = 2 * Math.PI * 74, total = it.min * 60000;
        const upd = () => {
          const left = total - (Date.now() - shownAt);
          const cd = el.querySelector('#cd'), t = el.querySelector('#cdt'); if (!cd) return;
          cd.setAttribute('stroke-dashoffset', C * Math.min(1, (Date.now() - shownAt) / total));
          cd.classList.toggle('red', left < 0);
          t.textContent = left >= 0 ? L.fmtClock(left) : `+${L.fmtClock(-left)}`;
          t.className = `cd-time num ${left < 0 ? 'red' : ''}`;
          later(upd, 1000);
        };
        upd();
      }
      el.querySelector('#bc').addEventListener('click', (e) => {
        const bc = e.currentTarget; if (bc.classList.contains('on')) return;
        bc.classList.add('on'); Sound.check();
        later(() => { i++; next(); }, 620);
      });
      el.querySelector('#skip').addEventListener('click', () => { i++; next(); });
    };
    next();
  }

  // ---------- morning ----------
  function morning() {
    const n = Store.now();
    const el = show(`
      <div class="fl-top"><span>${UI.longDate(Store.today())}</span><span></span></div>
      <div class="fl-eyebrow">Good morning</div>
      <div class="fl-title">Up since?</div>
      <div class="wheel-wrap"><div id="upwheel"></div></div>
      <div class="muted" id="uplate" style="font-size:15px;text-align:center;margin-top:20px"></div><div style="flex:1"></div>
      <div class="fl-bottom"><button class="btn big fill" id="go">Start Morning Routine</button></div>`);
    const hh = Array.from({ length: 24 }, (_, i) => i), mm = Array.from({ length: 60 }, (_, i) => i);
    let val = [n.getHours(), n.getMinutes()];
    const lateEl = el.querySelector('#uplate');
    const showLate = () => {
      const late = val[0] * 60 + val[1] - L.hm(S.settings.wake);
      lateEl.innerHTML = late > 15 ? `<span class="red">${L.fmtDur(late)} after ${S.settings.wake}</span>` : '<span class="green">On time</span>';
    };
    picker = window.app.picker.create({
      containerEl: el.querySelector('#upwheel'), toolbar: false, rotateEffect: true, value: val,
      cols: [{ values: hh, displayValues: hh.map(L.pad) }, { divider: true, content: ':' }, { values: mm, displayValues: mm.map(L.pad) }],
      on: { change(_p, v) { val = [+v[0], +v[1]]; showLate(); } },
    });
    showLate();
    el.querySelector('#go').addEventListener('click', () => {
      const up = L.at(Store.today(), val[0] * 60 + val[1]);
      Store.patchDay(Store.today(), { upAt: up.toISOString() });
      Sound.tick();
      routine('morning', (mins) => {
        Store.patchDay(Store.today(), { routineMin: Math.round(mins) });
        // tasks planned before "now" slide to start now
        const moves = L.pushBack(S.blocks, Store.today(), Math.ceil(L.minOfDay(Store.now()) / 5) * 5);
        const changed = S.blocks.filter((b) => b.id in moves).map((b) => ({ ...b, origStart: b.origStart || b.plannedStart, plannedStart: L.hmStr(moves[b.id]) }));
        if (changed.length) Store.saveBlocks(changed);
        overview();
      });
    });
  }

  function overview() {
    const key = Store.today(), n = Store.now();
    const list = UI.dayBlocks(key).filter((b) => !b.doneAt);
    const first = list.find((b) => b.kind === 'task');
    const planned = list.reduce((s, b) => s + (b.kind === 'task' ? b.expectedMin : 0), 0);
    const step = UI.stepFor(key);
    const el = show(`
      <div class="fl-top"><span>${UI.longDate(key)}</span><a id="x">Close</a></div>
      <div class="fl-eyebrow">${step ? `Step ${step.n} · ${UI.esc(step.title)}` : 'Today'}</div>
      <div class="fl-title">Your day</div>
      <div class="muted" style="margin-top:6px;font-size:15px">${list.length} items · ${L.fmtDur(planned)} of work planned</div>
      <div class="reveal-scroll" style="margin-top:14px"><div class="list rows fl-rows bare"><ul>${list.map((b) => UI.rowHTML(b, n)).join('')}</ul></div></div>
      <div class="fl-bottom" style="margin-top:12px">${first ? `<button class="btn big fill" id="go"><i class="f7-icons" style="font-size:20px">play_fill</i>Start: ${UI.esc(first.title)}</button>` : '<button class="btn big fill" id="plan">Plan Today</button>'}</div>`);
    el.querySelector('#x').addEventListener('click', close);
    const go = el.querySelector('#go'); if (go) go.addEventListener('click', () => { UI.start(first.id); close(); });
    const pl = el.querySelector('#plan'); if (pl) pl.addEventListener('click', () => { close(); UI.taskEditor({}); });
  }

  // ---------- evening ----------
  function finishDay() {
    const key = Store.today(), n = Store.now();
    for (const b of S.blocks) if (b.runningSince) Store.saveBlock({ ...b, actualMs: L.actualMs(b, n), runningSince: null, pausedAt: n.toISOString() });
    const st = L.dayStats(key, S.blocks, S.days, S.settings, n);
    const stats = {
      workMin: st.workMin, gymMin: st.gymMin, wastedMin: st.wastedMin, sleepMin: st.sleepMin, lateUpMin: st.lateUpMin,
      tasksDone: st.tasksDone, tasksPlanned: st.tasksPlanned, avgProd: st.avgProd, prod: st.prod, rings: st.rings, score: st.score,
    };
    Store.patchDay(key, { finishedAt: n.toISOString(), grade: st.grade, stats });
    reveal(key, true);
  }

  // Video-game style "Day passed / Day failed" screen.
  function countUp(el, to, fmt, ms = 700) {
    const t0 = performance.now();
    (function f(t) {
      const k = Math.max(0, Math.min(1, (t - t0) / ms)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(to * e);
      if (k < 1) requestAnimationFrame(f);
    })(t0);
  }
  function reveal(key, thenNight) {
    const day = S.days[key], st = day.stats, prev = (S.days[L.addDays(key, -1)] || {}).stats;
    const prodOf = (x) => (x.prod != null ? x.prod : x.workMin / S.settings.workGoalMin);
    const prod = prodOf(st), prevProd = prev ? prodOf(prev) : null;
    // "better" compares with yesterday; on the very first day it compares with the 75% streak bar
    const passed = prevProd == null ? prod >= L.STREAK_MIN : prod >= prevProd;
    const kept = prod >= L.STREAK_MIN;
    const step = UI.stepFor(key);
    const streakN = L.streak(S.days, key);
    const lines = [
      { ic: 'alarm_fill', label: 'Woke up', to: st.lateUpMin || 0, fmt: () => (day.upAt ? UI.timeOf(day.upAt) : '–'), good: st.lateUpMin != null && st.lateUpMin <= 15 },
      { ic: 'checkmark_alt', label: 'Tasks done', to: st.tasksDone, fmt: (v) => `${Math.round(v)} of ${st.tasksPlanned}`, good: st.tasksDone >= st.tasksPlanned * 0.8, prev: prev && prev.tasksDone, up: true },
      { ic: 'speedometer', label: 'Task speed', to: (st.avgProd - 1) * 100, fmt: (v) => (Math.round(v) >= 0 ? `${Math.round(v)}% faster` : `${-Math.round(v)}% slower`), good: st.avgProd >= 1, prev: prev && (prev.avgProd - 1) * 100, up: true },
      { ic: 'bolt_fill', label: 'Gym', to: st.gymMin, fmt: (v) => L.fmtDur(v), good: st.gymMin >= 30, prev: prev && prev.gymMin, up: true },
      { ic: 'hourglass', label: 'Wasted', to: st.wastedMin, fmt: (v) => L.fmtDur(v), good: st.wastedMin <= 45, prev: prev && prev.wastedMin, up: false },
      { ic: 'moon_fill', label: 'Slept', to: st.sleepMin || 0, fmt: (v) => (st.sleepMin == null ? '–' : L.fmtDur(v)), good: st.sleepMin >= 420, prev: prev && prev.sleepMin, up: true },
    ];
    const delta = (l) => {
      if (l.prev == null || l.to == null) return '';
      const d = l.to - l.prev; if (Math.abs(d) < 1) return '';
      const good = l.up ? d > 0 : d < 0;
      return `<span class="mp-d ${good ? 'green' : 'red'}">${d > 0 ? '▲' : '▼'}</span>`;
    };
    const score = Math.round(prod * 100);
    const R = 74, C = 2 * Math.PI * R;
    const title = prevProd == null ? (passed ? 'Strong first day' : 'First day done') : passed ? 'Better than yesterday' : 'Worse than yesterday';
    const vsTxt = prevProd == null ? '' : `${Math.round(prevProd * 100)}% yesterday`;
    const streakTxt = kept ? `${streakN} day streak` : 'Streak lost';
    const el = show(`<div class="mp ${passed ? 'pass' : 'fail'}">
      <canvas id="confetti"></canvas>
      <div class="fl-top"><span>${UI.longDate(key)}</span><a id="x">${thenNight ? '' : 'Close'}</a></div>
      <div class="reveal-scroll">
      <div class="mp-hero">
        <div class="mp-ring">
          <svg viewBox="0 0 168 168" aria-hidden="true"><circle class="mr-track" cx="84" cy="84" r="${R}"/>
            <circle class="mr-fill" id="mrf" cx="84" cy="84" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
          <div class="mr-in"><div class="mr-grade num" id="mrg"><span id="msv">0</span><small>%</small></div><div class="mr-score num">${L.fmtDur(st.workMin)} of ${L.fmtDur(S.settings.workGoalMin)}</div></div>
        </div>
        <div class="mp-title" id="mpt">${title}</div>
        <div class="mp-step" id="mps">${kept ? flameSVG(5, 15) : ''}<span><span class="${kept ? '' : 'red'}">${streakTxt}</span>${vsTxt ? `, ${vsTxt}` : ''}</span></div>
      </div>
      <div class="mp-lines">${lines.map((l, i) => `<div class="mp-line" id="ml${i}">
        <span class="mp-ic ${l.good ? 'good' : 'bad'}"><i class="f7-icons">${l.ic}</i></span>
        <span class="mp-l">${l.label}</span>${delta(l)}<span class="mp-v num" id="mv${i}">${l.fmt(0)}</span></div>`).join('')}</div>
      </div>
      <div class="fl-bottom mp-go" id="fb">${thenNight ? '<button class="btn big fill" id="go"><i class="f7-icons" style="font-size:20px">moon_fill</i>Night routine</button>' : '<button class="btn big gray" id="done">Close</button>'}</div>
    </div>`);
    // choreography: the ring fills while the score counts up, the grade pops, then each line ticks in
    later(() => {
      el.querySelector('#mrf').style.strokeDashoffset = C * (1 - Math.min(1, score / 100));
      el.querySelector('#mrg').classList.add('on');
      countUp(el.querySelector('#msv'), score, (v) => `${Math.round(v)}`, 1100);
      Sound.tick();
    }, 250);
    later(() => {
      el.querySelector('#mrg').classList.add('bump'); el.querySelector('#mpt').classList.add('on'); el.querySelector('#mps').classList.add('on');
      passed ? Sound.better() : Sound.worse();
      if (passed) window.FX.confetti(el.querySelector('#confetti'), 90);
    }, 1450);
    const t0 = 2000;
    lines.forEach((l, i) => later(() => {
      el.querySelector('#ml' + i).classList.add('on');
      const v = el.querySelector('#mv' + i);
      if (l.label === 'Woke up') v.textContent = l.fmt(); else countUp(v, l.to, l.fmt, 450);
      l.good ? Sound.tick() : Sound.pop();
    }, t0 + i * 220));
    later(() => { el.querySelector('#fb').classList.add('on'); }, t0 + lines.length * 220 + 300);
    const x = el.querySelector('#x'); if (x) x.addEventListener('click', close);
    const go = el.querySelector('#go'); if (go) go.addEventListener('click', night);
    const dn = el.querySelector('#done'); if (dn) dn.addEventListener('click', close);
  }

  function night() { routine('night', () => planTomorrow()); }

  function planTomorrow() {
    const key = Store.today(), tmr = L.addDays(key, 1), n = Store.now();
    const carry = S.blocks.filter((b) => b.date === key && b.kind === 'task' && !b.doneAt && !b.carried);
    const list = UI.dayBlocks(tmr);
    const step = UI.stepFor(tmr);
    const el = show(`
      <div class="fl-top"><span>${UI.longDate(tmr)}</span><span></span></div>
      <div class="fl-eyebrow">${step ? `Step ${step.n} · ${UI.esc(step.title)}` : 'Tomorrow'}</div>
      <div class="fl-title">Plan Tomorrow</div>
      <div class="reveal-scroll" style="margin-top:8px">
        ${carry.length ? `<div class="sec-head fl-sec"><h3>Carry over</h3><span class="muted">${carry.length} unfinished</span></div>
          <div class="list rows fl-rows"><ul>${carry.map((b) => `<li class="row"><div class="row-in">
            <a class="carry" data-carry="${b.id}" aria-label="Carry over"><i class="f7-icons">plus</i></a>
            <span class="r-txt"><span class="r-title">${UI.esc(b.title)}</span><span class="r-sub">${L.fmtDur(b.expectedMin)}${b.actualMs ? `, ${Math.round(b.actualMs / L.MIN)} min done` : ''}</span></span></div></li>`).join('')}</ul></div>` : ''}
        <div class="sec-head fl-sec"><h3>Tomorrow</h3><span class="muted">${list.length ? `${list.length} tasks, ${L.fmtDur(list.reduce((s, b) => s + b.expectedMin, 0))}` : 'Nothing yet'}</span></div>
        <div class="list rows fl-rows"><ul>${list.map((b) => UI.rowHTML(b, n)).join('')}
          <li class="row"><a class="row-in" id="add"><span class="r-ic run"><i class="f7-icons">plus</i></span><span class="r-txt"><span class="r-title green">New task</span></span></a></li></ul></div>
      </div>
      <div class="fl-bottom" style="margin-top:12px"><button class="btn big fill" id="bed"><i class="f7-icons" style="font-size:20px">moon_zzz_fill</i>I'm turning off my phone and going to bed</button></div>`);
    el.querySelectorAll('[data-carry]').forEach((a) => a.addEventListener('click', () => {
      const b = S.blocks.find((x) => x.id === a.dataset.carry);
      Store.saveBlock({ ...b, carried: true });
      const rest = Math.max(5, b.expectedMin - Math.round((b.actualMs || 0) / L.MIN));
      Store.saveBlock({ id: Store.uid(), date: tmr, kind: 'task', title: b.title, step: (step || {}).n || b.step, plannedStart: null, expectedMin: rest, fixed: false });
      Sound.pop(); planTomorrow();
    }));
    el.querySelectorAll('[data-block]').forEach((a) => a.addEventListener('click', () => {
      const b = S.blocks.find((x) => x.id === a.dataset.block); const p = UI.taskEditor({ block: b }); p.on('closed', planTomorrow);
    }));
    el.querySelector('#add').addEventListener('click', () => { const p = UI.taskEditor({ date: tmr }); p.on('closed', planTomorrow); });
    el.querySelector('#bed').addEventListener('click', bed);
  }

  function bed() {
    const key = Store.today(), n = Store.now();
    Store.patchDay(key, { bedAt: n.toISOString() });
    const wake = L.at(L.addDays(key, 1), L.hm(S.settings.wake));
    const sleepMin = (wake - n) / L.MIN;
    const el = show(`<div class="fl-center night">
      <i class="f7-icons moon">moon_stars_fill</i>
      <div class="fl-title" style="margin-top:18px">Good night</div>
      <div class="muted" style="margin-top:8px;font-size:17px">Alarm ${S.settings.wake} · ${L.fmtDur(sleepMin)} of sleep if you sleep now</div>
      </div><div class="fl-bottom"><div class="fl-skip" id="x">Close</div></div>`);
    Sound.grade();
    el.querySelector('#x').addEventListener('click', close);
    later(close, 6000);
  }

  window.Flows = { morning, overview, finishDay, reveal, night, planTomorrow, bed, close, isOpen: () => !root().hidden };
})();
