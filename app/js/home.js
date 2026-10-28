// Crunch - the redesigned screens: Today (hero + half-ring gauge + round actions), task rows,
// the full-screen task celebration, Plan (timeline) and History (one chart).
(function () {
  const L = window.Logic, Store = window.Store, S = Store.state, UI = window.UI, { Sound, flameSVG, confetti } = window.FX;
  const { $, esc, timeOf, stepFor, dayBlocks, running, DAYS, MONTHS } = UI;
  const icon = (name) => `<i class="f7-icons">${name}</i>`;
  const hoursOf = (ms) => Math.floor(ms / 3600000);
  // "9 h 20" with small unit letters, for the Today hero
  const heroDur = (min) => { min = Math.max(0, Math.floor(min)); return `${Math.floor(min / 60)}<span>h</span> ${L.pad(min % 60)}<span>m</span>`; };

  // ---------- rows (Today, Week "anytime", flows) ----------
  function rowHTML(b, n) {
    const run = !!b.runningSince, isDone = !!b.doneAt, act = L.actualMs(b, n);
    let lead = `<span class="r-ic todo">${b.kind === 'gym' ? icon('bolt_fill') : ''}</span>`;
    let trail = `<span class="r-dur">${L.fmtDur(b.expectedMin)}</span>`;
    let sub = b.plannedStart || 'Anytime';
    if (isDone) {
      const ok = L.onTime(b);
      lead = `<span class="r-ic ${ok ? 'ok' : 'late'}">${icon(ok ? 'checkmark_alt' : 'clock_fill')}</span>`;
      trail = `<span class="r-dur ${ok ? 'green' : 'red'}">${Math.round(act / L.MIN)}/${b.expectedMin} min</span>`;
      sub = `Done ${timeOf(b.doneAt)}`;
    } else if (run) {
      lead = `<span class="r-ic run">${icon(b.kind === 'gym' ? 'bolt_fill' : 'play_fill')}</span>`;
      trail = '<span class="r-dur green">Now</span>';
    } else if (b.kind === 'gym') {
      lead = `<span class="r-ic gym">${icon('bolt_fill')}</span>`;
    }
    if (!isDone && b.origStart && b.origStart !== b.plannedStart) sub += ` <s class="moved">${b.origStart}</s>`;
    if (!isDone && b.plannedStart && L.hm(b.plannedStart) + b.expectedMin > L.hm(S.settings.bed)) sub = `<span class="red">${sub} · after bedtime</span>`;
    return `<li class="swipeout row ${isDone ? 'is-done' : ''}" data-id="${b.id}">
      <div class="swipeout-content"><a class="row-in" data-block="${b.id}">
        ${lead}<span class="r-txt"><span class="r-title">${esc(b.title)}</span><span class="r-sub">${sub}</span></span>${trail}
      </a></div>
      <div class="swipeout-actions-right"><a class="swipeout-delete" data-confirm="false">Delete</a></div></li>`;
  }

  // ---------- Today ----------
  const ARC = Math.PI * 118; // half-ring length (r = 118)
  function gaugeHTML(n) {
    const r = running(), key = Store.today(), day = S.days[key] || {};
    let p = 0, cls = '', big = '', title = '', sub = '';
    if (day.finishedAt) {
      const pr = day.stats ? (day.stats.prod != null ? day.stats.prod : day.stats.workMin / S.settings.workGoalMin) : 0;
      p = Math.min(1, pr);
      cls = 'done'; big = `${Math.round(pr * 100)}%`;
      title = 'Day finished'; sub = day.bedAt ? `In bed since ${timeOf(day.bedAt)}` : 'Time for your night routine';
    } else if (r) {
      const act = L.actualMs(r, n), exp = r.expectedMin * L.MIN, over = act > exp;
      p = Math.min(1, act / exp); cls = over ? 'over' : r.kind === 'gym' ? 'gym' : '';
      big = L.fmtTimer(act);
      title = esc(r.title);
      sub = over ? `<span class="red">+${L.fmtDur((act - exp) / L.MIN)} over</span>` : `of ${L.fmtDur(r.expectedMin)}`;
    } else {
      const marks = [day.upAt, ...S.blocks.filter((b) => b.date === key).flatMap((b) => [b.doneAt, b.pausedAt])].filter(Boolean).map((x) => new Date(x));
      const idle = marks.length ? (n - Math.max(...marks)) / L.MIN : 0;
      cls = 'idle';
      big = idle >= 5 ? `<span class="red">${L.fmtDur(idle)}</span>` : '0:00';
      title = idle >= 5 ? 'Idle' : 'Nothing running';
      const next = dayBlocks(key).find((b) => !b.doneAt && b.kind === 'task');
      sub = next ? `Next: ${esc(next.title)}` : 'Add a task to start';
    }
    return `<div class="hgauge ${cls}" id="gauge">
      <svg viewBox="0 0 260 140" aria-hidden="true">
        <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/></linearGradient></defs>
        <path class="g-track" d="M12 130 A118 118 0 0 1 248 130"/>
        <path class="g-fill" id="g-fill" d="M12 130 A118 118 0 0 1 248 130" stroke-dasharray="${ARC}" stroke-dashoffset="${ARC * (1 - p)}"/>
      </svg>
      <div class="g-in"><div class="g-big num" id="g-big">${big}</div><div class="g-title">${title}</div><div class="g-sub num" id="g-sub">${sub}</div></div>
    </div>`;
  }

  function actionsHTML() {
    const r = running(), key = Store.today(), day = S.days[key] || {};
    const btn = (action, ic, label, primary, data = '') => `<button class="act ${primary ? 'primary' : ''}" ${data || `data-action="${action}"`}><span>${icon(ic)}</span>${label}</button>`;
    if (day.finishedAt) {
      return `<div class="acts">${btn('reveal', 'chart_bar_alt_fill', 'Results', true)}${day.bedAt ? '' : btn('night', 'moon_fill', 'Night')}${btn('more', 'ellipsis', 'More')}</div>`;
    }
    const next = dayBlocks(key).find((b) => !b.doneAt && !b.runningSince && b.kind === 'task');
    const first = r ? btn('', 'checkmark_alt', 'Done', true, `data-done="${r.id}"`)
      : next ? btn('', 'play_fill', 'Start', true, `data-start="${next.id}"`) : btn('new-task', 'plus', 'Add', true);
    return `<div class="acts">${first}
      ${r ? btn('', 'pause_fill', 'Pause', false, `data-pause="${r.id}"`) : ''}
      ${btn('more', 'ellipsis', 'More')}</div>`;
  }

  function barRow(ic, color, label, value, p, valCls = '') {
    return `<div class="bar-row"><span class="b-ic" style="--c:${color}">${icon(ic)}</span>
      <span class="b-main"><span class="b-top"><span>${label}</span><span class="num ${valCls}">${value}</span></span>
      <span class="b-track"><span style="width:${Math.max(0, Math.min(100, p * 100)).toFixed(1)}%;background:${color}"></span></span></span></div>`;
  }

  let showAll = false;
  function renderToday() {
    const n = Store.now(), key = Store.today(), day = S.days[key] || {};
    const h = L.hoursLeft(n, S.settings), st = L.dayStats(key, S.blocks, S.days, S.settings, n);
    const rel = new Date(S.settings.releaseAt);
    const all = dayBlocks(key);
    const left = all.filter((b) => b.kind === 'task' && !b.doneAt).length;
    const daysLeft = Math.max(0, Math.ceil((rel - n) / 86400000));
    const open = all.filter((b) => !b.doneAt);
    const list = showAll ? all : open.filter((b) => !b.runningSince).slice(0, 3);
    const tl = h.todayLeftMs / L.MIN;
    $('#today').innerHTML = `
      <div class="h-hero">
        <div class="h-num num ${tl < 120 ? 'red' : ''}" id="h-num">${heroDur(tl)}</div>
        <div class="h-sub">left today, until ${S.settings.bed}</div>
        <div class="h-pills"><span class="pill">${icon('flag_fill')}${daysLeft} days to release</span>
          <span class="pill ${left ? '' : 'green'}">${icon(left ? 'list_bullet' : 'checkmark_alt')}${left ? `${left} task${left > 1 ? 's' : ''} left` : 'All done'}</span></div>
      </div>
      ${gaugeHTML(n)}
      ${actionsHTML()}
      <div class="sec-head"><h3>${showAll ? 'Today' : 'Up next'}</h3>${all.length > 3 || showAll ? `<a data-action="toggle-all">${showAll ? 'Less' : `See all ${all.length}`}</a>` : ''}</div>
      ${list.length ? `<div class="list rows"><ul>${list.map((b) => rowHTML(b, n)).join('')}</ul></div>`
        : '<div class="empty">Nothing planned. Tap Add to plan your next task.</div>'}
      <div class="sec-head"><h3>So far</h3></div>
      <div class="bars">
        ${barRow('clock_fill', 'var(--green)', 'Work', `${L.fmtDur(st.workMin)} / ${L.fmtDur(S.settings.workGoalMin)}`, st.workMin / S.settings.workGoalMin)}
        ${barRow('checkmark_alt', 'var(--teal)', 'Tasks', `${st.tasksDone} of ${st.tasksPlanned}`, st.tasksPlanned ? st.tasksDone / st.tasksPlanned : 0)}
        ${barRow('hourglass', 'var(--red)', 'Wasted', L.fmtDur(st.wastedMin), st.wastedMin / 180, st.wastedMin > 60 ? 'red' : '')}
      </div>
      <div style="height:28px"></div>`;
    renderStreak();
  }

  function renderStreak() {
    const key = Store.today();
    $('.streak').innerHTML = `${flameSVG(L.combo(S.blocks, key), 20)}<span class="num">${L.streak(S.days, key)}</span>`;
  }

  // Per-second update of the moving numbers only.
  function tickToday() {
    const n = Store.now(), r = running();
    const h = L.hoursLeft(n, S.settings);
    const hn = $('#h-num'); if (hn) hn.innerHTML = heroDur(h.todayLeftMs / L.MIN);
    if (!r) return;
    const g = $("#gauge"); if (!g) return;
    const act = L.actualMs(r, n), exp = r.expectedMin * L.MIN, over = act > exp;
    if (over !== g.classList.contains('over')) return renderToday();
    $('#g-big').textContent = L.fmtTimer(act);
    if (over) $('#g-sub').innerHTML = `<span class="red">+${L.fmtDur((act - exp) / L.MIN)} over</span>`;
    $('#g-fill').setAttribute('stroke-dashoffset', ARC * (1 - Math.min(1, act / exp)));
  }

  // ---------- full-screen task celebration (Duolingo-style) ----------
  // Top: flame + verdict. Middle: combo meter towards the blue flame (7). Bottom: the next task + "Crunch the next task".
  function celebrate(ok, diffMin, comboN, block) {
    const el = $('#celebrate');
    const streakN = L.streak(S.days, Store.today());
    const act = block && block.actualMs ? Math.round(block.actualMs / L.MIN) : 0;
    const expMin = block && block.expectedMin ? block.expectedMin : act - diffMin;
    const pct = expMin ? Math.round((-diffMin / expMin) * 100) : 0;
    const next = dayBlocks(Store.today()).find((b) => !b.doneAt && !b.runningSince && b.kind === 'task' && (!block || b.id !== block.id));
    const lvl = ok ? Math.min(7, comboN) : 0;
    const segs = Array.from({ length: 7 }, (_, i) => `<i class="${i < lvl ? 'on' : ''}" style="animation-delay:${0.5 + i * 0.07}s"></i>`).join('');
    const meter = ok
      ? (comboN >= 7 ? 'Blue flame. Keep it going.' : `${7 - comboN} more on time for the blue flame`)
      : 'Combo back to 0';
    el.innerHTML = `<div class="cel-full ${ok ? 'win' : 'lose'}">
      <canvas id="confetti"></canvas>
      <div class="cel-center">
        <div class="cel-flame">${flameSVG(lvl, ok ? 120 : 80)}</div>
        <h1 class="cel-title">${ok ? (comboN >= 3 ? `${comboN} in a row!` : 'On time!') : 'Done, but late'}</h1>
        <p class="cel-sub">${ok ? (pct > 0 ? `<b class="cel-pct">${pct}% faster</b> than you expected` : 'Right on your estimate') : `<b class="cel-pct late">${-pct}% slower</b> than you expected`}</p>
        <p class="cel-sub2">${act ? `${L.fmtDur(act)} of ${L.fmtDur(expMin)} planned` : ''}</p>
        <div class="cel-meter"><div class="cm-segs">${segs}</div><div class="cm-cap"><span>${meter}</span><span>${streakN} day streak</span></div></div>
      </div>
      <div class="cel-foot">
        ${next ? `<div class="cel-next"><span class="r-ic todo">${'<i class="f7-icons">play_fill</i>'}</span>
          <span class="r-txt"><span class="cn-cap">Up next</span><span class="r-title">${esc(next.title)}</span></span>
          <span class="r-dur">${L.fmtDur(next.expectedMin)}</span></div>
          <button class="btn big fill" id="cel-go"><i class="f7-icons" style="font-size:20px">bolt_fill</i>Crunch the next task</button>
          <button class="cel-later" id="cel-x">Not now</button>`
        : '<button class="btn big fill" id="cel-x">Continue</button>'}
      </div>
    </div>`;
    el.hidden = false;
    const shut = () => { el.hidden = true; el.innerHTML = ''; };
    el.querySelector('#cel-x').addEventListener('click', shut);
    const go = el.querySelector('#cel-go'); if (go) go.addEventListener('click', () => { shut(); UI.start(next.id); });
    if (ok) {
      Sound.win(); confetti(el.querySelector('#confetti'));
      for (let i = 0; i < lvl; i++) setTimeout(() => { if (!el.hidden) Sound.seg(); }, 500 + i * 70 + 150);
    } else Sound.soft();
  }

  // ---------- Plan (release countdown + step timeline) ----------
  function renderPlan() {
    const n = Store.now(), key = Store.today();
    const h = L.hoursLeft(n, S.settings), rel = new Date(S.settings.releaseAt);
    const { n: dn, total } = L.dayNumber(n, S.settings);
    const cd = Math.floor(h.clockMs / 86400000), ch = Math.floor((h.clockMs % 86400000) / 3600000);
    const segs = Array.from({ length: total }, (_, i) => `<i class="${i + 1 < dn ? 'past' : i + 1 === dn ? 'now' : ''}"></i>`).join('');
    const range = (s) => (s.start === s.end ? UI.shortDate(s.start) : `${UI.shortDate(s.start)} – ${UI.shortDate(s.end)}`);
    $('#plan').innerHTML = `
      <div class="h-hero plan-hero">
        <div class="h-num num">${cd}<span>d</span> ${ch}<span>h</span></div>
        <div class="h-sub">until release, ${DAYS[rel.getDay()]} ${rel.getDate()} ${MONTHS[rel.getMonth()]} at ${timeOf(rel)}</div>
        <div class="days-bar" title="Day ${dn} of ${total}">${segs}</div>
        <div class="days-cap"><span>Day ${Math.max(1, dn)} of ${total}</span><span>${hoursOf(h.workMs)} work hours left</span></div>
      </div>
      <div class="tline">
        ${S.steps.map((s) => {
          const state = s.done ? 'done' : key >= s.start && key <= s.end ? 'now' : key > s.end ? 'late' : 'next';
          const tag = { done: 'Done', now: 'Today', late: 'Late', next: '' }[state];
          return `<a class="ts ${state}" data-step="${s.n}"><span class="ts-dot">${state === 'done' ? icon('checkmark_alt') : ''}</span>
            <span class="ts-txt"><span class="ts-title">${esc(s.title)}</span><span class="ts-sub">${range(s)}${s.note ? `. ${esc(s.note)}` : ''}</span></span>
            ${tag ? `<span class="ts-tag">${tag}</span>` : ''}</a>`;
        }).join('')}
        <div class="ts release"><span class="ts-dot">${icon('flag_fill')}</span><span class="ts-txt"><span class="ts-title">Release</span><span class="ts-sub">${UI.shortDate(L.dateKey(rel))}, ${timeOf(rel)}</span></span></div>
      </div><div style="height:28px"></div>`;
  }

  // ---------- History: one chart per metric, or "All" lines together ----------
  let metric = 'prod', hl = null;
  const prodOf = (st) => (st.prod != null ? st.prod : st.workMin / S.settings.workGoalMin);
  const METRICS = {
    prod: { label: 'Productivity', short: 'Prod.', color: 'var(--accent)', get: (st) => prodOf(st) * 100, fmt: (v) => `${Math.round(v)}%`, goal: 75, goalLabel: 'streak', target: 100 },
    tasks: { label: 'Tasks', short: 'Tasks', color: 'var(--teal)', get: (st) => (st.tasksPlanned ? (st.tasksDone / st.tasksPlanned) * 100 : null), fmt: (v) => `${Math.round(v)}%`, target: 100 },
    wasted: { label: 'Wasted', short: 'Wasted', color: 'var(--red)', get: (st) => st.wastedMin / 60, fmt: (v) => `${v.toFixed(1)} h`, lowerBetter: true, target: 3 },
    sleep: { label: 'Sleep', short: 'Sleep', color: 'var(--indigo)', get: (st) => (st.sleepMin == null ? null : st.sleepMin / 60), fmt: (v) => `${v.toFixed(1)} h`, goal: 8, goalLabel: '8 h', target: 8 },
  };
  function historyRows(n) {
    const key = Store.today(), rows = [];
    for (let i = 13; i >= 0; i--) {
      const k = L.addDays(key, -i), d = S.days[k];
      if (!d || (!d.upAt && !d.finishedAt)) { rows.push({ k, empty: true }); continue; }
      const st = d.stats || L.dayStats(k, S.blocks, S.days, S.settings, n);
      rows.push({ k, st, live: !d.finishedAt });
    }
    // start the chart at the first logged day, so it has no empty left part
    const first = rows.findIndex((r) => !r.empty);
    return first > 0 ? rows.slice(Math.min(first, rows.length - 2)) : rows;
  }
  // monotone cubic path: smooth, but never overshoots the real values
  function smooth(pts) {
    if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    const n = pts.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ` C${pts[i][0] + h},${pts[i][1] + h * t[i]} ${pts[i + 1][0] - h},${pts[i + 1][1] - h * t[i + 1]} ${pts[i + 1][0]},${pts[i + 1][1]}`;
    }
    return d;
  }
  const W = 360, H = 170, PL = 8, PR = 8, PT = 14, PB = 22;
  const xOf = (rows) => (i) => PL + (i * (W - PL - PR)) / Math.max(1, rows.length - 1);
  const dayLabels = (rows, x) => rows.map((r, i) => ((rows.length - 1 - i) % 3 === 0 ? `<text x="${x(i)}" y="${H - 5}" text-anchor="middle" class="h-lbl">${L.parseDate(r.k).getDate()}</text>` : '')).join('');
  function chart(rows) {
    const M = METRICS[metric], x = xOf(rows);
    const vals = rows.map((r) => (r.empty ? null : M.get(r.st)));
    const goal = M.goal;
    const max = Math.max(goal || 0, ...vals.filter((v) => v != null), 1) * 1.15;
    const y = (v) => PT + (1 - v / max) * (H - PT - PB);
    const pts = vals.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
    if (!pts.length) return '<div class="empty">Finish a day to start your chart.</div>';
    const d = smooth(pts), last = pts[pts.length - 1];
    const area = `${d} L${last[0]},${H - PB} L${pts[0][0]},${H - PB} Z`;
    return `<svg class="hchart" viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="hg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${M.color}" stop-opacity=".35"/><stop offset="1" stop-color="${M.color}" stop-opacity="0"/></linearGradient></defs>
      ${goal ? `<line x1="${PL}" x2="${W - PR}" y1="${y(goal)}" y2="${y(goal)}" class="h-goal"/><text x="${W - PR}" y="${y(goal) - 5}" text-anchor="end" class="h-lbl">${M.goalLabel}</text>` : ''}
      <path d="${area}" fill="url(#hg)"/>
      <path class="h-line" d="${d}" fill="none" stroke="${M.color}" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="5" fill="${M.color}" stroke="#000" stroke-width="2.5"/>
      ${dayLabels(rows, x)}
    </svg>`;
  }
  // Every metric as % of its own target, so they share one scale. Tap a line (or its chip) to highlight it.
  function chartAll(rows) {
    const x = xOf(rows), y = (v) => PT + (1 - Math.min(v, 150) / 150) * (H - PT - PB);
    const lines = Object.entries(METRICS).map(([k, M]) => {
      const pts = rows.map((r, i) => { const v = r.empty ? null : M.get(r.st); return v == null ? null : [x(i), y((v / M.target) * 100), v]; }).filter(Boolean);
      return { k, M, pts };
    }).filter((l) => l.pts.length);
    if (!lines.length) return '<div class="empty">Finish a day to start your chart.</div>';
    const on = lines.find((l) => l.k === hl);
    return `<svg class="hchart all ${hl ? 'has-hl' : ''}" viewBox="0 0 ${W} ${H}">
      <line x1="${PL}" x2="${W - PR}" y1="${y(100)}" y2="${y(100)}" class="h-goal"/><text x="${W - PR}" y="${y(100) - 5}" text-anchor="end" class="h-lbl">target</text>
      ${lines.map((l) => `<g class="h-ser ${l.k === hl ? 'on' : ''}" data-line="${l.k}">
        <path d="${smooth(l.pts)}" fill="none" stroke="${l.M.color}" stroke-width="2.5" stroke-linecap="round"/>
        <path d="${smooth(l.pts)}" fill="none" stroke="transparent" stroke-width="22" class="h-hit"/></g>`).join('')}
      ${on ? on.pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${on.M.color}" stroke="#000" stroke-width="2"/><text x="${p[0]}" y="${p[1] - 9}" text-anchor="middle" class="h-val">${on.M.fmt(p[2]).replace(/ h$/, 'h')}</text>`).join('') : ''}
      ${dayLabels(rows, x)}
    </svg>
    <div class="h-legend">${lines.map((l) => `<a class="h-chip ${l.k === hl ? 'on' : ''} ${hl && l.k !== hl ? 'dim' : ''}" data-line="${l.k}" style="--c:${l.M.color}"><i></i>${l.M.label}</a>`).join('')}</div>`;
  }
  const miniRing = (p) => { const C = 2 * Math.PI * 14; return `<svg viewBox="0 0 36 36"><circle class="rt" cx="18" cy="18" r="14"/><circle class="rf" cx="18" cy="18" r="14" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - Math.min(1, p))}"/></svg>`; };
  const prodTone = (p) => (p >= L.STREAK_MIN ? 'good' : p >= 0.5 ? 'mid' : 'low');
  function renderHistory() {
    const n = Store.now(), rows = historyRows(n), all = metric === 'all', M = METRICS[all ? 'prod' : metric];
    const done = rows.filter((r) => !r.empty && !r.live);
    const week = done.slice(-7);
    const avgOf = (list) => { const v = list.map((r) => M.get(r.st)).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const a = avgOf(week);
    const lastTwo = done.slice(-2);
    const better = lastTwo.length === 2 ? (M.lowerBetter ? M.get(lastTwo[1].st) <= M.get(lastTwo[0].st) : M.get(lastTwo[1].st) >= M.get(lastTwo[0].st)) : null;
    const big = a == null ? '–' : M.fmt(a).replace(/ h$/, '<span>h</span>').replace(/%$/, '<span>%</span>');
    $('#history').innerHTML = `
      <div class="h-hero hist-hero">
        <div class="h-num num">${big}</div>
        <div class="h-sub">${M.label.toLowerCase()} per day, last 7 days</div>
        ${better == null ? '' : `<div class="h-pills"><span class="pill ${better ? 'green' : 'red'}">${icon(better ? 'arrow_up_right' : 'arrow_down_right')}${better ? 'Better than the day before' : 'Worse than the day before'}</span></div>`}
      </div>
      <div class="seg-wrap"><div class="segmented segmented-strong">
        ${[...Object.entries(METRICS).map(([k, m]) => [k, m.short]), ['all', 'All']].map(([k, label]) => `<a class="button ${k === metric ? 'button-active' : ''}" data-metric="${k}">${label}</a>`).join('')}
        <span class="segmented-highlight"></span></div></div>
      <div class="chart-wrap">${all ? chartAll(rows) : chart(rows)}</div>
      <div class="sec-head"><h3>Days</h3><span class="muted">${L.streak(S.days, Store.today())} day streak</span></div>
      <div class="list rows"><ul>
        ${rows.slice().reverse().filter((r) => !r.empty).map((r) => { const p = prodOf(r.st); return `<li class="row"><div class="row-in">
          <span class="r-ic pct ${r.live ? 'live' : prodTone(p)}">${r.live ? icon('timer') : miniRing(p)}</span>
          <span class="r-txt"><span class="r-title">${UI.longDate(r.k)}</span><span class="r-sub">${r.live ? 'Today, still going' : `${L.fmtDur(r.st.workMin)} work, ${L.fmtDur(r.st.wastedMin)} wasted`}</span></span>
          <span class="r-dur num">${all || metric === 'prod' ? `${Math.round(p * 100)}%` : M.fmt(M.get(r.st) ?? 0)}</span></div></li>`; }).join('')}
      </ul></div><div style="height:28px"></div>`;
  }

  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-metric]'); if (m) { metric = m.dataset.metric; hl = null; Sound.tap(); renderHistory(); return; }
    const ln = e.target.closest('[data-line]'); if (ln) { hl = hl === ln.dataset.line ? null : ln.dataset.line; Sound.tap(); renderHistory(); return; }
    const t = e.target.closest('[data-action="toggle-all"]'); if (t) { showAll = !showAll; renderToday(); }
  });

  Object.assign(window.UI, { rowHTML, renderToday, renderStreak, tickToday, celebrate, renderPlan, renderHistory });
})();
