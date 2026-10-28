// Crunch - Today, Plan, History, the task editor, Settings, and task actions.
(function () {
  const L = window.Logic, Store = window.Store, S = Store.state, { Sound, flameSVG } = window.FX;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const longDate = (key) => { const d = L.parseDate(key); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const shortDate = (key) => { const d = L.parseDate(key); return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
  const timeOf = (iso) => { const d = new Date(iso); return `${L.pad(d.getHours())}:${L.pad(d.getMinutes())}`; };

  const stepFor = (key) => S.steps.find((s) => key >= s.start && key <= s.end) || null;
  const stepTitle = (n) => { const s = S.steps.find((x) => x.n === n); return s ? `Step ${s.n} · ${s.title}` : ''; };
  const dayBlocks = (key) => S.blocks.filter((b) => b.date === key).sort((a, b) => {
    if (!a.plannedStart !== !b.plannedStart) return a.plannedStart ? -1 : 1;
    return (a.plannedStart || '99').localeCompare(b.plannedStart || '99') || (a.sort || 0) - (b.sort || 0);
  });
  const running = () => S.blocks.find((b) => b.runningSince);

  // ---------- task actions ----------
  function stopAll(nowD, exceptId) {
    for (const b of S.blocks) {
      if (b.runningSince && b.id !== exceptId) {
        Store.saveBlock({ ...b, actualMs: L.actualMs(b, nowD), runningSince: null, pausedAt: nowD.toISOString() });
      }
    }
  }
  function start(id) {
    const n = Store.now(); stopAll(n, id);
    const b = S.blocks.find((x) => x.id === id); if (!b) return;
    Store.saveBlock({ ...b, runningSince: n.toISOString(), doneAt: null });
    Sound.pop();
  }
  function pause(id) {
    const n = Store.now(), b = S.blocks.find((x) => x.id === id); if (!b || !b.runningSince) return;
    Store.saveBlock({ ...b, actualMs: L.actualMs(b, n), runningSince: null, pausedAt: n.toISOString() });
    Sound.soft();
  }
  function done(id) {
    const n = Store.now(), b = S.blocks.find((x) => x.id === id); if (!b) return;
    const nb = { ...b, actualMs: L.actualMs(b, n), runningSince: null, doneAt: n.toISOString() };
    Store.saveBlock(nb);
    if (nb.kind !== 'task') { Sound.check(); return; }
    const diffMin = Math.round((nb.actualMs - nb.expectedMin * L.MIN) / L.MIN);
    celebrate(L.onTime(nb), diffMin, L.combo(S.blocks, nb.date));
  }
  function undo(id) {
    const b = S.blocks.find((x) => x.id === id); if (b) Store.saveBlock({ ...b, doneAt: null });
  }
  function startGym() {
    const key = Store.today();
    const planned = S.blocks.find((b) => b.date === key && b.kind === 'gym' && !b.doneAt);
    if (planned) return start(planned.id);
    const n = Store.now();
    const b = { id: Store.uid(), date: key, kind: 'gym', title: 'Gym', plannedStart: null, expectedMin: 60, fixed: false };
    Store.saveBlock(b); start(b.id);
  }

  function celebrate(ok, diffMin, comboN) {
    const el = $('#celebrate');
    const streakN = L.streak(S.days, Store.today());
    if (ok) {
      el.innerHTML = `<div class="cel">${flameSVG(comboN, 54)}
        <div class="cel-num roll num"><span>${Math.max(0, comboN - 1)}</span><span>${comboN}</span></div>
        <div class="cel-text">${diffMin < 0 ? `Under time by ${-diffMin} min` : 'Right on time'}</div></div>`;
      Sound.win();
    } else {
      el.innerHTML = `<div class="cel grey">${flameSVG(0, 40)}<div class="cel-text">Over by ${L.fmtDur(diffMin)} · combo reset</div></div>`;
      Sound.soft();
    }
    el.hidden = false;
    clearTimeout(celebrate.t); celebrate.t = setTimeout(() => { el.hidden = true; }, 1650);
    void streakN;
  }

  function blockMenu(b) {
    const app = window.app, run = !!b.runningSince, isDone = !!b.doneAt;
    const buttons = [];
    if (!isDone && !run) buttons.push({ text: b.kind === 'gym' ? 'Start Gym' : 'Start', bold: true, onClick: () => start(b.id) });
    if (run) buttons.push({ text: 'Done', bold: true, onClick: () => done(b.id) }, { text: 'Pause', onClick: () => pause(b.id) });
    if (!isDone && !run && b.actualMs) buttons.push({ text: 'Mark Done', onClick: () => done(b.id) });
    if (isDone) buttons.push({ text: 'Mark Not Done', onClick: () => undo(b.id) });
    buttons.push({ text: 'Edit', onClick: () => taskEditor({ block: b }) });
    buttons.push({ text: 'Delete', color: 'red', onClick: () => Store.deleteBlock(b.id) });
    app.actions.create({ buttons: [[{ text: esc(b.title), label: true }, ...buttons], [{ text: 'Cancel', bold: true }]] }).open();
  }

  // ---------- Today ----------
  function heroHTML(n) {
    const h = L.hoursLeft(n, S.settings), dn = L.dayNumber(n, S.settings);
    const workH = Math.floor(h.workMs / 3600000);
    const cd = Math.floor(h.clockMs / 86400000), ch = Math.floor((h.clockMs % 86400000) / 3600000);
    const tl = h.todayLeftMs / L.MIN;
    const day = S.days[Store.today()] || {};
    let upChip = '<span class="chip">Not up yet</span>';
    if (day.upAt) {
      const late = (new Date(day.upAt) - L.at(Store.today(), L.hm(S.settings.wake))) / L.MIN;
      upChip = late > 15 ? `<span class="chip red">Up ${timeOf(day.upAt)} · +${late >= 60 ? L.fmtDur(late) : Math.round(late) + 'm'}</span>`
        : `<span class="chip green">Up ${timeOf(day.upAt)}</span>`;
    }
    return `<div class="card hero">
      <div class="hero-top">
        <div><div class="hero-hours num" id="hero-hours">${workH}<small>h</small></div><div class="hero-sub">work hours to release</div></div>
        <div class="hero-side"><span class="muted">Today</span><b class="num ${tl < 120 ? 'red' : ''}" id="hero-today">${L.fmtDur(tl)}</b><span class="muted">until ${S.settings.bed}</span></div>
      </div>
      <div class="hero-meta"><span class="muted num hero-clock" id="hero-clock">Day ${Math.max(1, dn.n)} of ${dn.total} · ${cd}d ${ch}h total</span>${upChip}</div>
    </div>`;
  }

  function nowCardHTML(n) {
    const r = running();
    const key = Store.today();
    if (!r) {
      const day = S.days[key] || {};
      if (day.finishedAt) return '';
      const marks = [day.upAt, ...S.blocks.filter((b) => b.date === key).flatMap((b) => [b.doneAt, b.pausedAt])].filter(Boolean).map((x) => new Date(x));
      const idleMin = marks.length ? (n - Math.max(...marks)) / L.MIN : 0;
      const next = dayBlocks(key).find((b) => !b.doneAt && b.kind === 'task');
      return `<div class="card now">
        <div class="now-label"><span>Nothing running</span>${idleMin > 5 ? `<span class="red num" id="idle">Idle ${L.fmtDur(idleMin)}</span>` : ''}</div>
        <div class="now-title">${next ? esc(next.title) : 'Plan your next task'}</div>
        <div class="now-actions">${next ? `<button class="btn fill" data-start="${next.id}"><i class="f7-icons" style="font-size:18px">play_fill</i>Start</button>` : `<button class="btn fill" data-action="new-task">New Task</button>`}</div>
      </div>`;
    }
    const act = L.actualMs(r, n), exp = r.expectedMin * L.MIN, over = act > exp;
    const p = Math.min(1, act / exp), C = 2 * Math.PI * 25;
    const label = r.kind === 'gym' ? 'Gym' : (stepTitle(r.step) || 'Now');
    return `<div class="card now ${over ? 'over' : ''}" id="now-card" data-id="${r.id}">
      <div class="now-label"><span ${r.kind === 'gym' ? 'class="green"' : ''}>${esc(label)}</span><span class="muted">${r.plannedStart ? r.plannedStart : ''}</span></div>
      <div class="now-title">${esc(r.title)}</div>
      <div class="now-row">
        <svg class="now-ring" width="62" height="62" viewBox="0 0 62 62"><g transform="rotate(-90 31 31)">
          <circle cx="31" cy="31" r="25" stroke="rgba(118,118,128,.3)"/>
          <circle id="now-ring" cx="31" cy="31" r="25" stroke="${over ? 'var(--red)' : r.kind === 'gym' ? 'var(--green)' : 'var(--orange)'}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/></g></svg>
        <div><div class="now-time num ${over ? 'red' : ''}" id="now-time">${L.fmtTimer(act)}<span class="of"> / ${L.fmtTimer(exp)}</span></div>
        <div class="now-over red num" id="now-over">${over ? `+${L.fmtDur((act - exp) / L.MIN)} over` : ''}</div></div>
      </div>
      <div class="now-actions">
        <button class="btn gray" data-pause="${r.id}"><i class="f7-icons" style="font-size:18px">pause_fill</i>Pause</button>
        <button class="btn ${r.kind === 'gym' ? 'green' : 'fill'}" data-done="${r.id}"><i class="f7-icons" style="font-size:18px">checkmark_alt</i>Done</button>
      </div></div>`;
  }

  function rowHTML(b, n, opts = {}) {
    const run = !!b.runningSince, isDone = !!b.doneAt;
    const act = L.actualMs(b, n);
    let check = '<span class="check"></span>', after = '', sub = L.fmtDur(b.expectedMin);
    if (isDone) {
      const ok = L.onTime(b);
      check = `<span class="check ${ok ? 'on' : 'late'}"><i class="f7-icons">${ok ? 'checkmark_alt' : 'xmark'}</i></span>`;
      after = `<span class="num ${ok ? 'green' : 'red'}">${Math.round(act / L.MIN)} / ${b.expectedMin}</span>`;
      sub = `${Math.round(L.productivity(b) * 100)}% · done ${timeOf(b.doneAt)}`;
    } else if (run) {
      check = '<span class="check run"></span>';
      after = '<span class="orange">Now</span>';
    } else if (act > 0) {
      sub = `${L.fmtDur(b.expectedMin)} · ${Math.round(act / L.MIN)} min so far`;
    }
    if (b.kind === 'gym') sub = `Gym · ${sub}`;
    const moved = b.origStart && b.origStart !== b.plannedStart && !isDone ? ` <span class="moved">moved from ${b.origStart}</span>` : '';
    const late = !isDone && b.plannedStart && L.hm(b.plannedStart) + b.expectedMin > L.hm(S.settings.bed);
    return `<li class="swipeout ${isDone ? 'task-done' : ''} kind-${b.kind}" data-id="${b.id}">
      <div class="swipeout-content"><a class="item-content item-link no-chevron" data-block="${b.id}">
        <div class="item-media">${check}</div>
        <div class="item-inner"><div class="trow">
          ${opts.noTime ? '' : `<span class="task-time ${late ? 'red' : ''}">${b.plannedStart || '–'}</span>`}
          <div class="trow-body"><div class="item-title">${esc(b.title)}</div><div class="task-sub">${sub}${moved}</div></div>
          <div class="trow-after num">${after}</div></div></div></a></div>
      <div class="swipeout-actions-right"><a class="swipeout-delete" data-confirm="false">Delete</a></div></li>`;
  }

  function tilesHTML(st) {
    const tile = (icon, color, label, val) => `<div class="card tile"><div class="tile-label"><i class="f7-icons" style="color:${color}">${icon}</i>${label}</div><div class="tile-value num">${val}</div></div>`;
    return `<div class="tiles">
      ${tile('clock_fill', 'var(--orange)', 'Work', L.fmtDur(st.workMin))}
      ${tile('bolt_fill', 'var(--green)', 'Gym', L.fmtDur(st.gymMin))}
      ${tile('hourglass', 'var(--red)', 'Wasted', `<span class="${st.wastedMin > 60 ? 'red' : ''}">${L.fmtDur(st.wastedMin)}</span>`)}
      ${tile('moon_fill', 'var(--indigo)', 'Slept', st.sleepMin == null ? '–' : L.fmtDur(st.sleepMin))}
    </div>`;
  }

  function renderToday() {
    const n = Store.now(), key = Store.today(), day = S.days[key] || {};
    const st = L.dayStats(key, S.blocks, S.days, S.settings, n);
    const list = dayBlocks(key);
    const step = stepFor(key);
    const finished = !!day.finishedAt;
    const gymRunning = S.blocks.some((b) => b.kind === 'gym' && b.runningSince);
    $('#today').innerHTML = `
      ${heroHTML(n)}
      ${finished ? `<div class="card now"><div class="now-label"><span>Day finished</span><span class="muted">${timeOf(day.finishedAt)}</span></div>
          <div class="now-row"><span class="grade-big g-${day.grade}">${day.grade}</span><div><div class="now-title" style="margin:0">Grade ${day.grade}</div><div class="muted">Score ${Math.round((day.stats ? day.stats.score : st.score) * 100)}</div></div></div>
          <div class="now-actions"><button class="btn gray" data-action="reveal">See Results</button>${day.bedAt ? '' : '<button class="btn fill" data-action="night">Night Routine</button>'}</div></div>`
        : nowCardHTML(n)}
      <div class="section-title">Schedule</div>
      <div class="list list-strong list-dividers inset tasks" style="margin-top:0"><ul>
        ${list.map((b) => rowHTML(b, n)).join('')}
        <li><a class="item-content item-link no-chevron" data-action="new-task"><div class="item-media"><i class="f7-icons orange" style="font-size:22px">plus_circle_fill</i></div><div class="item-inner"><div class="item-title orange">New Task</div></div></a></li>
        ${gymRunning ? '' : `<li><a class="item-content item-link no-chevron" data-action="gym"><div class="item-media"><i class="f7-icons green" style="font-size:22px">bolt_circle_fill</i></div><div class="item-inner"><div class="item-title green">Start Gym</div></div></a></li>`}
      </ul></div>
      <div class="section-title">Today so far</div>
      ${tilesHTML(st)}
      ${finished ? '' : `<div class="finish"><button class="btn big tinted" data-action="finish"><i class="f7-icons" style="font-size:20px">moon_stars_fill</i>Finish the Day</button></div>`}
      <div style="height:24px"></div>`;
    renderStreak();
  }

  function renderStreak() {
    const key = Store.today();
    $('.streak').innerHTML = `${flameSVG(L.combo(S.blocks, key), 20)}<span class="num">${L.streak(S.days, key)}</span>`;
  }

  // Per-second update of the live numbers only (keeps taps and scrolling smooth).
  function tickToday() {
    const n = Store.now(), r = running();
    const h = L.hoursLeft(n, S.settings);
    const hh = $('#hero-hours'); if (hh) hh.innerHTML = `${Math.floor(h.workMs / 3600000)}<small>h</small>`;
    const ht = $('#hero-today'); if (ht) ht.textContent = L.fmtDur(h.todayLeftMs / L.MIN);
    if (!r) return;
    const card = $('#now-card');
    if (!card || card.dataset.id !== r.id) return renderToday();
    const act = L.actualMs(r, n), exp = r.expectedMin * L.MIN, over = act > exp;
    if (over !== card.classList.contains('over')) return renderToday();
    $('#now-time').innerHTML = `${L.fmtTimer(act)}<span class="of"> / ${L.fmtTimer(exp)}</span>`;
    $('#now-over').textContent = over ? `+${L.fmtDur((act - exp) / L.MIN)} over` : '';
    const C = 2 * Math.PI * 25; $('#now-ring').setAttribute('stroke-dashoffset', C * (1 - Math.min(1, act / exp)));
  }

  // ---------- Plan ----------
  function renderPlan() {
    const n = Store.now(), key = Store.today();
    const h = L.hoursLeft(n, S.settings);
    const rel = new Date(S.settings.releaseAt);
    const cd = Math.floor(h.clockMs / 86400000), ch = Math.floor((h.clockMs % 86400000) / 3600000);
    const range = (s) => (s.start === s.end ? shortDate(s.start) : `${shortDate(s.start)} – ${shortDate(s.end)}`);
    $('#plan').innerHTML = `
      <div class="card release-card">
        <div class="muted" style="font-size:13px;text-transform:uppercase;letter-spacing:.4px">Release</div>
        <div class="big num">${Math.floor(h.workMs / 3600000)} h</div>
        <div class="muted">work hours left · ${cd} d ${ch} h on the clock</div>
        <div style="margin-top:10px;font-weight:600">${DAYS[rel.getDay()]} ${rel.getDate()} ${MONTHS[rel.getMonth()]} · ${timeOf(rel)}</div>
      </div>
      <div class="section-title">Steps</div>
      <div class="list list-strong list-dividers inset media-list"><ul>
        ${S.steps.map((s) => {
          const cls = s.done ? 'step-done' : key >= s.start && key <= s.end ? 'step-now' : key > s.end ? 'step-late' : '';
          const status = s.done ? '<span class="green">Done</span>' : cls === 'step-now' ? '<span class="orange">Today</span>' : cls === 'step-late' ? '<span class="red">Late</span>' : '';
          return `<li class="${cls}"><a class="item-content item-link no-chevron" data-step="${s.n}">
            <div class="item-media"><span class="step-n">${s.done ? '<i class="f7-icons" style="font-size:15px">checkmark_alt</i>' : s.n}</span></div>
            <div class="item-inner"><div class="item-title-row"><div class="item-title">${esc(s.title)}</div><div class="item-after">${status}</div></div>
            <div class="item-subtitle muted" style="font-size:13px">${range(s)}${s.note ? ' · ' + esc(s.note) : ''}</div></div></a></li>`;
        }).join('')}
      </ul></div><div style="height:24px"></div>`;
  }
  function stepMenu(nStep) {
    const s = S.steps.find((x) => x.n === nStep); if (!s) return;
    window.app.actions.create({ buttons: [[{ text: `Step ${s.n} · ${esc(s.title)}`, label: true },
      { text: s.done ? 'Mark Not Done' : 'Mark Done', bold: true, onClick: () => Store.setKV('steps', S.steps.map((x) => (x.n === nStep ? { ...x, done: !x.done } : x))) }],
      [{ text: 'Cancel', bold: true }]] }).open();
  }

  // ---------- History ----------
  function historyRows(n) {
    const key = Store.today(), rows = [];
    for (let i = 13; i >= 0; i--) {
      const k = L.addDays(key, -i), d = S.days[k];
      if (!d || (!d.upAt && !d.finishedAt)) { rows.push({ k, empty: true }); continue; }
      const st = d.stats || L.dayStats(k, S.blocks, S.days, S.settings, n);
      rows.push({ k, st, grade: d.grade || (i === 0 ? null : st.grade), live: !d.finishedAt });
    }
    return rows;
  }
  function bars(rows, field, color, goal) {
    const W = 340, H = 110, pad = 18, bw = (W - 8) / rows.length;
    const vals = rows.map((r) => (r.empty || r.st[field] == null ? 0 : r.st[field] / 60));
    const max = Math.max(goal ? goal / 60 : 0, ...vals, 1) * 1.1;
    const y = (v) => H - pad - (v / max) * (H - pad - 6);
    return `<svg viewBox="0 0 ${W} ${H}">
      ${goal ? `<line x1="0" x2="${W}" y1="${y(goal / 60)}" y2="${y(goal / 60)}" stroke="rgba(235,235,245,.3)" stroke-dasharray="3 3"/><text x="${W - 2}" y="${y(goal / 60) - 4}" text-anchor="end">goal</text>` : ''}
      ${vals.map((v, i) => `<rect x="${4 + i * bw + bw * 0.18}" y="${y(v)}" width="${bw * 0.64}" height="${Math.max(0, H - pad - y(v))}" rx="3" fill="${color}" opacity="${rows[i].live ? 0.55 : 1}"/>`).join('')}
      ${rows.map((r, i) => (i % 2 === (rows.length - 1) % 2 ? `<text x="${4 + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${L.parseDate(r.k).getDate()}</text>` : '')).join('')}
    </svg>`;
  }
  function scoreLine(rows) {
    const W = 340, H = 110, pad = 18, bw = (W - 8) / rows.length;
    const pts = rows.map((r, i) => (r.empty ? null : [4 + i * bw + bw / 2, H - pad - r.st.score * (H - pad - 8)])).filter(Boolean);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const gy = (s) => H - pad - s * (H - pad - 8);
    return `<svg viewBox="0 0 ${W} ${H}">
      ${[['A', 0.9], ['B', 0.75], ['C', 0.6]].map(([g, s]) => `<line x1="14" x2="${W}" y1="${gy(s)}" y2="${gy(s)}" stroke="rgba(84,84,88,.5)" stroke-width=".5"/><text x="0" y="${gy(s) + 3}">${g}</text>`).join('')}
      <path d="${path}" fill="none" stroke="var(--orange)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#000" stroke="var(--orange)" stroke-width="2"/>`).join('')}
      ${rows.map((r, i) => (i % 2 === (rows.length - 1) % 2 ? `<text x="${4 + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${L.parseDate(r.k).getDate()}</text>` : '')).join('')}
    </svg>`;
  }
  function renderHistory() {
    const n = Store.now(), rows = historyRows(n);
    const done = rows.filter((r) => !r.empty && !r.live);
    const last = done[done.length - 1], prev = done[done.length - 2];
    const avg7 = done.slice(-7).reduce((s, r) => s + r.st.score, 0) / Math.max(1, done.slice(-7).length);
    let trend = '<div class="card trend"><div><b>No finished days yet</b><span class="muted">Finish a day to see how you compare.</span></div></div>';
    if (last) {
      const up = prev ? last.st.score >= prev.st.score : true;
      const vsAvg = Math.round((last.st.score - avg7) * 100);
      trend = `<div class="card trend"><div class="trend-icon" style="background:${up ? 'rgba(48,209,88,.18)' : 'rgba(255,69,58,.18)'}"><i class="f7-icons ${up ? 'green' : 'red'}">${up ? 'arrow_up_right' : 'arrow_down_right'}</i></div>
        <div><b>${up ? 'Getting better' : 'Slipping'}</b><span class="muted">Last day ${last.grade || last.st.grade}${prev ? ` vs ${prev.grade || prev.st.grade} the day before` : ''} · ${vsAvg >= 0 ? '+' : ''}${vsAvg} vs 7-day average</span></div></div>`;
    }
    const chart = (title, right, svg) => `<div class="card chart"><div class="chart-head"><span class="chart-title">${title}</span><span class="muted" style="font-size:13px">${right}</span></div>${svg}</div>`;
    const avg = (f) => { const v = done.slice(-7).map((r) => r.st[f]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
    $('#history').innerHTML = `
      ${trend}
      <div class="section-title">Last 14 days</div>
      ${chart('Day score', `streak ${L.streak(S.days, Store.today())} 🔥`, scoreLine(rows))}
      <div style="height:10px"></div>
      ${chart('Work', `avg ${L.fmtDur(avg('workMin'))}`, bars(rows, 'workMin', 'var(--orange)', S.settings.workGoalMin))}
      <div style="height:10px"></div>
      ${chart('Wasted', `avg ${L.fmtDur(avg('wastedMin'))}`, bars(rows, 'wastedMin', 'var(--red)'))}
      <div style="height:10px"></div>
      ${chart('Sleep', `avg ${L.fmtDur(avg('sleepMin'))}`, bars(rows, 'sleepMin', 'var(--indigo)', 480))}
      <div style="height:10px"></div>
      ${chart('Gym', `avg ${L.fmtDur(avg('gymMin'))}`, bars(rows, 'gymMin', 'var(--green)'))}
      <div class="section-title">Days</div>
      <div class="list list-strong list-dividers inset"><ul>
        ${rows.slice().reverse().filter((r) => !r.empty).map((r) => `<li><div class="item-content">
          <div class="item-media"><span class="grade-badge g-${r.grade || r.st.grade}">${r.live ? '·' : r.grade || r.st.grade}</span></div>
          <div class="item-inner"><div class="item-title">${longDate(r.k)}${r.live ? ' <span class="muted">· today</span>' : ''}</div>
          <div class="item-after num">${L.fmtDur(r.st.workMin)}</div></div></div></li>`).join('')}
      </ul></div><div style="height:24px"></div>`;
  }

  // ---------- task editor (iOS "New Event" style popup) ----------
  function taskEditor({ block, date, start } = {}) {
    const app = window.app;
    const isNew = !block;
    const key = block ? block.date : date || Store.today();
    const b = block ? { ...block } : {
      id: Store.uid(), date: key, kind: 'task', title: '', step: (stepFor(key) || {}).n || null,
      plannedStart: start || null, expectedMin: 30, fixed: false,
    };
    const durText = (m) => L.fmtDur(m);
    const popup = app.popup.create({
      swipeToClose: true, push: true,
      content: `<div class="popup task-popup"><div class="view"><div class="page">
        <div class="navbar"><div class="navbar-bg"></div><div class="navbar-inner">
          <div class="left"><a class="link popup-close">Cancel</a></div>
          <div class="title">${isNew ? 'New Task' : 'Edit Task'}</div>
          <div class="right"><a class="link" data-save style="font-weight:600">${isNew ? 'Add' : 'Done'}</a></div></div></div>
        <div class="page-content">
          <div class="list list-strong list-dividers inset ilabels" style="margin-top:20px"><ul>
            <li class="item-content item-input"><div class="item-inner"><div class="item-input-wrap">
              <input type="text" name="title" placeholder="Title" value="${esc(b.title)}" autocomplete="off" class="title-in"></div></div></li>
            <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Kind</div><div class="item-input-wrap">
              <select name="kind"><option value="task">Task</option><option value="gym">Gym</option><option value="routine">Routine</option></select></div></div></li>
          </ul></div>
          <div class="list list-strong list-dividers inset"><ul>
            <li><a class="item-content item-link no-chevron" data-toggle="dur"><div class="item-inner"><div class="item-title">Duration</div><div class="item-after orange num" data-dur>${durText(b.expectedMin)}</div></div></a></li>
            <li class="r-wheel" data-wheel="dur" hidden><div id="pick-dur"></div></li>
            <li><div class="item-content"><div class="item-inner"><div class="item-title">Set a time</div><div class="item-after">
              <label class="toggle"><input type="checkbox" name="timed" ${b.plannedStart ? 'checked' : ''}><span class="toggle-icon"></span></label></div></div></div></li>
            <li data-row="start" ${b.plannedStart ? '' : 'hidden'}><a class="item-content item-link no-chevron" data-toggle="start"><div class="item-inner"><div class="item-title">Starts</div><div class="item-after orange num" data-start>${b.plannedStart || '09:00'}</div></div></a></li>
            <li class="r-wheel" data-wheel="start" hidden><div id="pick-start"></div></li>
            <li><div class="item-content"><div class="item-inner"><div class="item-title">Fixed time</div><div class="item-after">
              <label class="toggle"><input type="checkbox" name="fixed" ${b.fixed ? 'checked' : ''}><span class="toggle-icon"></span></label></div></div></div></li>
          </ul></div>
          <div class="list list-strong list-dividers inset ilabels"><ul>
            <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Date</div><div class="item-input-wrap">
              <input type="date" name="date" value="${key}"></div></div></li>
            <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Step</div><div class="item-input-wrap">
              <select name="step"><option value="">None</option>${S.steps.map((s) => `<option value="${s.n}" ${s.n === b.step ? 'selected' : ''}>${s.n} · ${esc(s.title)}</option>`).join('')}</select></div></div></li>
          </ul></div>
          ${isNew ? '' : '<div class="list list-strong list-dividers inset"><ul><li><a class="item-content item-link no-chevron" data-del><div class="item-inner"><div class="item-title red" style="width:100%;text-align:center">Delete Task</div></div></a></li></ul></div>'}
          <div class="block-footer" style="margin:0 32px;color:var(--label3)">"Fixed time" makes it a wall in the planner: other tasks flow around it.</div>
        </div></div></div></div>`,
      on: {
        opened(p) { if (isNew) { const t = p.el.querySelector('[name=title]'); t && t.focus(); } },
        closed(p) { pickers.forEach((x) => x.destroy()); p.destroy(); },
      },
    });
    const el = popup.el;
    el.querySelector('[name=kind]').value = b.kind;
    const pickers = [];
    const hours = Array.from({ length: 13 }, (_, i) => i), mins = Array.from({ length: 12 }, (_, i) => i * 5);
    const makers = {};
    makers.dur = () => pickers.push(app.picker.create({
      containerEl: el.querySelector('#pick-dur'), toolbar: false, rotateEffect: true,
      value: [Math.min(12, Math.floor(b.expectedMin / 60)), b.expectedMin % 60 - (b.expectedMin % 5)],
      cols: [{ values: hours, displayValues: hours.map((h) => `${h} h`) }, { values: mins, displayValues: mins.map((m) => `${m} min`) }],
      on: { change(_p, v) { const m = Math.max(5, +v[0] * 60 + +v[1]); b.expectedMin = m; el.querySelector('[data-dur]').textContent = durText(m); } },
    }));
    const ps = b.plannedStart || '09:00';
    const hh = Array.from({ length: 24 }, (_, i) => i);
    makers.start = () => pickers.push(app.picker.create({
      containerEl: el.querySelector('#pick-start'), toolbar: false, rotateEffect: true,
      value: [+ps.slice(0, 2), Math.round(+ps.slice(3) / 5) * 5 % 60],
      cols: [{ values: hh, displayValues: hh.map(L.pad) }, { divider: true, content: ':' }, { values: mins, displayValues: mins.map(L.pad) }],
      on: { change(_p, v) { b.plannedStart = `${L.pad(+v[0])}:${L.pad(+v[1])}`; el.querySelector('[data-start]').textContent = b.plannedStart; } },
    }));
    el.querySelectorAll('[data-toggle]').forEach((a) => a.addEventListener('click', () => {
      const k = a.dataset.toggle, w = el.querySelector(`[data-wheel="${k}"]`); w.hidden = !w.hidden;
      if (!w.hidden && makers[k]) { makers[k](); makers[k] = null; }
    }));
    el.querySelector('[name=timed]').addEventListener('change', (e) => {
      el.querySelector('[data-row="start"]').hidden = !e.target.checked;
      if (!e.target.checked) el.querySelector('[data-wheel="start"]').hidden = true;
      if (e.target.checked && !b.plannedStart) b.plannedStart = el.querySelector('[data-start]').textContent;
    });
    el.querySelector('[data-save]').addEventListener('click', () => {
      const f = (n) => el.querySelector(`[name=${n}]`);
      b.title = f('title').value.trim() || (f('kind').value === 'gym' ? 'Gym' : 'Untitled task');
      b.kind = f('kind').value;
      b.date = f('date').value || key;
      b.step = f('step').value ? +f('step').value : null;
      b.fixed = f('fixed').checked;
      if (!f('timed').checked) b.plannedStart = null;
      if (block && block.plannedStart !== b.plannedStart) b.origStart = null;
      Store.saveBlock(b);
      popup.close();
    });
    const del = el.querySelector('[data-del]');
    if (del) del.addEventListener('click', () => { Store.deleteBlock(b.id); popup.close(); });
    popup.open();
    return popup;
  }

  // ---------- Settings ----------
  let routineTab = 'morning';
  function settingsPopup() {
    const app = window.app;
    const popup = app.popup.create({
      swipeToClose: true, push: true,
      content: `<div class="popup"><div class="view"><div class="page">
        <div class="navbar"><div class="navbar-bg"></div><div class="navbar-inner"><div class="left"></div><div class="title">Settings</div>
          <div class="right"><a class="link popup-close" style="font-weight:600">Done</a></div></div></div>
        <div class="page-content" id="settings-body"></div></div></div></div>`,
      on: { closed(p) { p.destroy(); } },
    });
    const body = popup.el.querySelector('#settings-body');
    const pickers = [];
    function render() {
      pickers.splice(0).forEach((p) => p.destroy());
      const items = S.routines[routineTab];
      const stepper = (name, val, label) => `<li><div class="item-content"><div class="item-inner"><div class="item-title">${label}</div><div class="item-after">
        <span class="num" style="margin-right:12px;color:var(--label)">${L.fmtDur(val)}</span>
        <div class="stepper stepper-small"><div class="stepper-button-minus" data-step="${name}" data-d="-15"></div><div class="stepper-button-plus" data-step="${name}" data-d="15"></div></div></div></div></div></li>`;
      body.innerHTML = `
        <div class="block-title">Day</div>
        <div class="list list-strong list-dividers inset ilabels"><ul>
          <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Wake up</div><div class="item-input-wrap"><input type="time" name="wake" value="${S.settings.wake}"></div></div></li>
          <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Bedtime</div><div class="item-input-wrap"><input type="time" name="bed" value="${S.settings.bed}"></div></div></li>
          ${stepper('workGoalMin', S.settings.workGoalMin, 'Daily work goal')}
          ${stepper('wasteAllowMin', S.settings.wasteAllowMin, 'Meals & breaks')}
        </ul></div>
        <div class="block-title">Routines</div>
        <div class="seg-wrap"><div class="segmented segmented-strong">
          <a class="button ${routineTab === 'morning' ? 'button-active' : ''}" data-rt="morning">Morning</a>
          <a class="button ${routineTab === 'night' ? 'button-active' : ''}" data-rt="night">Night</a>
          <span class="segmented-highlight"></span></div></div>
        <div class="list list-strong list-dividers inset sortable sortable-enabled" id="rlist"><ul>
          ${items.map((it, i) => `<li class="swipeout" data-i="${i}"><div class="swipeout-content"><div class="item-content"><div class="item-inner">
              <div class="item-title">${esc(it.title)}</div>
              <div class="item-after"><span class="r-time num ${it.min ? '' : 'empty'}" data-rtime="${i}">${it.min ? L.fmtDur(it.min) : '+ time'}</span></div></div></div>
              <div class="r-wheel" data-rw="${i}" hidden><div></div></div></div>
              <div class="sortable-handler"></div>
              <div class="swipeout-actions-right"><a class="swipeout-delete" data-confirm="false">Delete</a></div></li>`).join('')}
        </ul></div>
        <div class="list list-strong list-dividers inset" style="margin-top:-20px"><ul><li><a class="item-content item-link no-chevron" data-radd><div class="item-media"><i class="f7-icons orange" style="font-size:22px">plus_circle_fill</i></div><div class="item-inner"><div class="item-title orange">Add Item</div></div></a></li></ul></div>
        <div class="block-footer" style="margin:-24px 32px 24px">Drag to reorder. Swipe left to delete. Tap the time to set how long it takes.</div>
        <div class="block-title">Notifications</div>
        <div class="list list-strong list-dividers inset"><ul><li><a class="item-content item-link no-chevron" data-push><div class="item-inner"><div class="item-title">Notifications</div><div class="item-after" id="push-state">${window.Push ? window.Push.label() : ''}</div></div></a></li></ul></div>
        <div class="block-title">Account</div>
        <div class="list list-strong list-dividers inset"><ul>
          <li class="item-content"><div class="item-inner"><div class="item-title">Signed in</div><div class="item-after">${esc(S.user ? S.user.email : '')}</div></div></li>
          ${Store.DEMO ? '' : '<li><a class="item-content item-link no-chevron" data-signout><div class="item-inner"><div class="item-title red">Sign Out</div></div></a></li>'}
        </ul></div><div style="height:30px"></div>`;
      body.querySelectorAll('input[type=time]').forEach((inp) => inp.addEventListener('change', () => Store.setKV('settings', { ...S.settings, [inp.name]: inp.value })));
      body.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.step, v = Math.max(0, S.settings[k] + +b.dataset.d);
        Store.setKV('settings', { ...S.settings, [k]: v }); render();
      }));
      body.querySelectorAll('[data-rt]').forEach((b) => b.addEventListener('click', () => { routineTab = b.dataset.rt; render(); }));
      const save = (list) => Store.setKV('routines', { ...S.routines, [routineTab]: list });
      body.querySelectorAll('[data-rtime]').forEach((t) => t.addEventListener('click', () => {
        const i = +t.dataset.rtime, w = body.querySelector(`[data-rw="${i}"]`);
        w.hidden = !w.hidden;
        if (!w.hidden && !w.dataset.made) {
          w.dataset.made = 1;
          const vals = Array.from({ length: 61 }, (_, k) => k);
          let timer = null;
          pickers.push(app.picker.create({
            containerEl: w.querySelector('div'), toolbar: false, rotateEffect: true, value: [S.routines[routineTab][i].min || 0],
            cols: [{ values: vals, displayValues: vals.map((m) => (m ? `${m} min` : 'No time')) }],
            on: { change(_p, v) {
              const m = +v[0] || null;
              t.textContent = m ? L.fmtDur(m) : '+ time'; t.classList.toggle('empty', !m);
              clearTimeout(timer); timer = setTimeout(() => save(S.routines[routineTab].map((x, k) => (k === i ? { ...x, min: m } : x))), 250);
            } },
          }));
        }
      }));
      const rl = body.querySelector('#rlist');
      rl.addEventListener('sortable:sort', (e) => {
        const { from, to } = e.detail; const list = S.routines[routineTab].slice();
        const [m] = list.splice(from, 1); list.splice(to, 0, m); save(list); render();
      });
      rl.querySelectorAll('li.swipeout').forEach((li) => li.addEventListener('swipeout:deleted', () => {
        save(S.routines[routineTab].filter((_, k) => k !== +li.dataset.i)); render();
      }));
      body.querySelector('[data-radd]').addEventListener('click', () => {
        app.dialog.prompt('', 'New routine item', (v) => { if (v && v.trim()) { save([...S.routines[routineTab], { id: Store.uid(), title: v.trim(), min: null }]); render(); } });
      });
      body.querySelector('[data-push]').addEventListener('click', async () => { if (window.Push) { await window.Push.enable(); render(); } });
      const so = body.querySelector('[data-signout]'); if (so) so.addEventListener('click', () => Store.signOut());
    }
    render();
    popup.open();
  }

  window.UI = {
    $, esc, longDate, shortDate, timeOf, stepFor, dayBlocks, running,
    start, pause, done, startGym, blockMenu, stepMenu, taskEditor, settingsPopup, celebrate,
    renderToday, tickToday, renderPlan, renderHistory, rowHTML, renderStreak,
  };
})();
