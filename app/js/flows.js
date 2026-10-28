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
          ${it.min ? `<div class="routine-min">${L.fmtDur(it.min)}</div>` : ''}
          <div class="bigcheck" id="bc">
            ${it.min ? `<svg viewBox="0 0 112 112"><circle class="cd" id="cd" cx="56" cy="56" r="54.5" stroke-dasharray="${2 * Math.PI * 54.5}" stroke-dashoffset="0"/></svg>` : ''}
            <div class="tick"><svg viewBox="0 0 112 112"><path d="M36 58 L50 72 L77 42"/></svg></div>
          </div>
          <div class="cd-time num" id="cdt"></div>
        </div>
        <div class="fl-bottom"><div class="fl-skip" id="skip">Skip</div></div>`);
      const shownAt = Date.now();
      if (it.min) {
        const C = 2 * Math.PI * 54.5, total = it.min * 60000;
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
      <div class="fl-center" style="flex:1"><div class="muted" id="uplate" style="font-size:15px"></div></div>
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
      <div class="reveal-scroll" style="margin-top:14px"><div class="list list-strong list-dividers inset tasks" style="margin:0"><ul>${list.map((b) => UI.rowHTML(b, n)).join('')}</ul></div></div>
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
      tasksDone: st.tasksDone, tasksPlanned: st.tasksPlanned, avgProd: st.avgProd, rings: st.rings, score: st.score,
    };
    Store.patchDay(key, { finishedAt: n.toISOString(), grade: st.grade, stats });
    reveal(key, true);
  }

  function reveal(key, thenNight) {
    const day = S.days[key], st = day.stats, prev = (S.days[L.addDays(key, -1)] || {}).stats;
    const C = (r) => 2 * Math.PI * r;
    const ring = (r, color, p, id) => `<circle class="bgc" cx="105" cy="105" r="${r}" stroke="${color}"/>
      <circle class="fg" id="${id}" cx="105" cy="105" r="${r}" stroke="${color}" stroke-dasharray="${C(r)}" stroke-dashoffset="${C(r)}" data-p="${Math.min(1, p)}"/>`;
    const delta = (cur, old, goodUp, fmt) => {
      if (old == null || cur == null) return '';
      const d = cur - old; if (Math.abs(d) < 0.5) return '<span class="rv-d muted">=</span>';
      const good = goodUp ? d > 0 : d < 0;
      return `<span class="rv-d ${good ? 'green' : 'red'}">${d > 0 ? '▲' : '▼'}${fmt(Math.abs(d))}</span>`;
    };
    const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${L.pad(Math.round(m % 60))}` : `${Math.round(m)}m`);
    const up = day.upAt ? UI.timeOf(day.upAt) : '–';
    const rows = [
      { ok: st.lateUpMin != null && st.lateUpMin <= 15, label: 'Woke up', val: up, d: delta(st.lateUpMin, prev && prev.lateUpMin, false, mins) },
      { ok: st.tasksDone >= st.tasksPlanned * 0.8, meh: st.tasksDone >= st.tasksPlanned * 0.5, label: 'Tasks done', val: `${st.tasksDone} / ${st.tasksPlanned}`, d: delta(st.tasksDone, prev && prev.tasksDone, true, (x) => x) },
      { ok: st.avgProd >= 0.95, meh: st.avgProd >= 0.75, label: 'Productivity', val: `${Math.round(st.avgProd * 100)}%`, d: delta(st.avgProd * 100, prev && prev.avgProd * 100, true, (x) => `${Math.round(x)}`) },
      { ok: st.workMin >= S.settings.workGoalMin, meh: st.workMin >= S.settings.workGoalMin * 0.7, label: 'Work', val: L.fmtDur(st.workMin), d: delta(st.workMin, prev && prev.workMin, true, mins) },
      { ok: st.gymMin >= 30, label: 'Gym', val: L.fmtDur(st.gymMin), d: delta(st.gymMin, prev && prev.gymMin, true, mins) },
      { ok: st.wastedMin <= 30, meh: st.wastedMin <= 90, label: 'Wasted', val: L.fmtDur(st.wastedMin), d: delta(st.wastedMin, prev && prev.wastedMin, false, mins) },
      { ok: st.sleepMin != null && st.sleepMin >= 420, meh: st.sleepMin >= 360, label: 'Slept', val: st.sleepMin == null ? '–' : L.fmtDur(st.sleepMin), d: delta(st.sleepMin, prev && prev.sleepMin, true, mins) },
    ];
    const better = prev ? st.score >= prev.score : null;
    const streakN = L.streak(S.days, key);
    const el = show(`
      <div class="fl-top"><span>${UI.longDate(key)}</span><a id="x">${thenNight ? '' : 'Close'}</a></div>
      <div class="fl-title" style="margin-top:6px">Your Day</div>
      <div class="reveal-scroll">
        <div class="rings"><svg viewBox="0 0 210 210">
          ${ring(92, 'var(--ring-work)', st.rings.work, 'r1')}${ring(68, 'var(--ring-tasks)', st.rings.tasks, 'r2')}${ring(44, 'var(--ring-disc)', st.rings.discipline, 'r3')}
        </svg></div>
        <div class="ring-legend"><span id="l1" style="color:var(--ring-work)">Work ${Math.round(st.rings.work * 100)}%</span><span id="l2" style="color:var(--ring-tasks)">Tasks ${Math.round(st.rings.tasks * 100)}%</span><span id="l3" style="color:var(--ring-disc)">Discipline ${Math.round(st.rings.discipline * 100)}%</span></div>
        <div class="rv-list">${rows.map((r, i) => `<div class="rv-row" id="rv${i}">
          <span class="rv-ic ${r.ok ? 'good' : r.meh ? 'meh' : 'bad'}"><i class="f7-icons">${r.ok ? 'checkmark_alt' : r.meh ? 'minus' : 'xmark'}</i></span>
          <span class="rv-label">${r.label}</span><span class="rv-val">${r.val}</span>${r.d || '<span class="rv-d"></span>'}</div>`).join('')}</div>
        <div class="grade-reveal" id="gr"><span class="grade-big g-${day.grade}">${day.grade}</span>
          <div><b>${better == null ? 'First graded day' : better ? 'Better than yesterday' : 'Worse than yesterday'}</b>
          <span class="gr-sub">${L.goodGrade(day.grade) ? `${flameSVG(5, 12)} ${streakN} day streak` : 'Streak reset · B or better keeps it alive'}</span></div></div>
      </div>
      <div class="fl-bottom" style="margin-top:12px;opacity:0;transition:opacity .4s" id="fb">
        ${thenNight ? '<button class="btn big fill" id="go">Night Routine</button>' : '<button class="btn big gray" id="done">Close</button>'}</div>`);
    // choreography: rings close one by one, rows tick in, grade pops
    ['r1', 'r2', 'r3'].forEach((id, i) => later(() => {
      const c = el.querySelector('#' + id); const r = +c.getAttribute('r');
      c.setAttribute('stroke-dashoffset', C(r) * (1 - +c.dataset.p));
      el.querySelector('#l' + (i + 1)).classList.add('on');
      later(() => Sound.tick(), 700);
    }, 300 + i * 650));
    const t0 = 300 + 3 * 650 + 500;
    rows.forEach((r, i) => later(() => { el.querySelector('#rv' + i).classList.add('on'); r.ok ? Sound.check() : Sound.pop(); }, t0 + i * 420));
    const tg = t0 + rows.length * 420 + 250;
    later(() => { el.querySelector('#gr').classList.add('on'); Sound.grade(); const sc = el.querySelector('.reveal-scroll'); sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); }, tg);
    later(() => { el.querySelector('#fb').style.opacity = 1; }, tg + 500);
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
        ${carry.length ? `<div class="section-title" style="margin-left:16px">Carry over from today</div>
          <div class="list list-strong list-dividers inset" style="margin:0"><ul>${carry.map((b) => `<li><div class="item-content"><div class="item-inner">
            <div class="item-title">${UI.esc(b.title)}<div class="task-sub">${L.fmtDur(b.expectedMin)}${b.actualMs ? ` · ${Math.round(b.actualMs / L.MIN)} min done` : ''}</div></div>
            <div class="item-after"><a class="link" data-carry="${b.id}"><i class="f7-icons orange" style="font-size:26px">plus_circle_fill</i></a></div></div></div></li>`).join('')}</ul></div>` : ''}
        <div class="section-title" style="margin-left:16px">Tomorrow · ${list.length} items · ${L.fmtDur(list.reduce((s, b) => s + b.expectedMin, 0))}</div>
        <div class="list list-strong list-dividers inset tasks" style="margin:0"><ul>${list.map((b) => UI.rowHTML(b, n)).join('')}
          <li><a class="item-content item-link no-chevron" id="add"><div class="item-media"><i class="f7-icons orange" style="font-size:22px">plus_circle_fill</i></div><div class="item-inner"><div class="item-title orange">New Task</div></div></a></li></ul></div>
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
