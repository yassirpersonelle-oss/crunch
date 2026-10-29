// Crunch - the redesigned screens: Today (dynamic hero + half-ring gauge + round actions), task rows,
// the full-screen task celebration, Plan (timeline) and History (one chart).
(function () {
  const L = window.Logic, Store = window.Store, S = Store.state, UI = window.UI, { Sound, flameSVG, confetti, tilt3D } = window.FX;
  const { $, esc, timeOf, stepFor, dayBlocks, running, DAYS, MONTHS } = UI;
  const icon = (name) => `<i class="f7-icons">${name}</i>`;
  const hoursOf = (ms) => Math.floor(ms / 3600000);
  const heroDur = (min) => { const s = Math.max(0, Math.floor(min * 60)); return `${Math.floor(s / 3600)}<span>h</span> ${L.pad(Math.floor(s / 60) % 60)}<span>m</span> ${L.pad(s % 60)}<span>s</span>`; };

  // Dynamic hero state: starts with a brief contextual welcome on app open, then adapts to running/idle or user toggle
  let heroMode = 'auto'; // 'auto' | 'today' | 'release' | 'context'
  const openedAt = Date.now();

  function toggleHeroMode() {
    const order = ['auto', 'today', 'release', 'context'];
    heroMode = order[(order.indexOf(heroMode) + 1) % order.length];
    Sound.tap();
    renderToday();
  }

  function heroContent(n, h, all, left, daysLeft) {
    const tl = h.todayLeftMs / L.MIN;
    const r = running();
    const step = stepFor(Store.today());
    const workH = Math.round(h.workMs / 3600000);
    const justOpened = Date.now() - openedAt < 4500;
    // When idle in auto mode, alternate every 8s between today's countdown and days/work-hours left
    const idleCycle = !r && heroMode === 'auto' && Math.floor(Date.now() / 8000) % 2 === 1;

    if (heroMode === 'context' || (heroMode === 'auto' && justOpened)) {
      const topText = r
        ? `Locked in`
        : left === 0 && all.length > 0
          ? `All done!`
          : step
            ? `Step ${step.n} · ${esc(step.title)}`
            : `${daysLeft}<span>d</span> left`;
      const subText = r
        ? `${esc(r.title)} · ${left} task${left === 1 ? '' : 's'} remaining today`
        : `${left} task${left === 1 ? '' : 's'} left today · ${workH}h waking work to release`;
      return {
        numCls: 'h-num h-context',
        numHTML: topText,
        subHTML: `${subText} · <a class="bed-link" data-action="sleep-wake">bed ${esc(S.settings.bed)}</a>`,
      };
    }

    if (heroMode === 'release' || idleCycle) {
      const cd = Math.floor(h.clockMs / 86400000), ch = Math.floor((h.clockMs % 86400000) / 3600000);
      return {
        numCls: 'h-num num',
        numHTML: `${cd}<span>d</span> ${ch}<span>h</span>`,
        subHTML: `${workH} waking hrs to release · <a class="bed-link" data-action="sleep-wake">wake ${esc(S.settings.wake)}–${esc(S.settings.bed)}</a>`,
      };
    }

    return {
      numCls: `h-num num ${tl < 120 ? 'red' : ''}`,
      numHTML: heroDur(tl),
      subHTML: `left today, until <a class="bed-link" data-action="sleep-wake">${esc(S.settings.bed)}</a>`,
    };
  }

  // ---------- rows (Today, Week "anytime", flows) ----------
  function rowHTML(b, n) {
    const run = !!b.runningSince, isDone = !!b.doneAt, act = L.actualMs(b, n);
    const hex = window.Cats.hex(window.Cats.of(b));
    let lead = `<span class="r-ic todo" style="--c:${hex}">${b.kind === 'gym' ? icon('bolt_fill') : ''}</span>`;
    let trail = `<span class="r-dur" data-roll-dur="${b.id}">${L.fmtDur(b.expectedMin)}</span>`;
    let at = `<span class="r-at num ${b.plannedStart ? '' : 'any'}" data-roll-start="${b.id}">${b.plannedStart || 'Any'}</span>`;
    const notes = [];
    if (isDone) {
      const ok = L.onTime(b);
      lead = `<span class="r-ic ${ok ? 'ok' : 'late'}">${icon(ok ? 'checkmark_alt' : 'clock_fill')}</span>`;
      trail = `<span class="r-dur ${ok ? 'green' : 'red'}">${Math.round(act / L.MIN)}/${b.expectedMin} min</span>`;
      at = `<span class="r-at num">${timeOf(b.doneAt)}</span>`;
    } else if (run) {
      lead = `<span class="r-ic run">${icon(b.kind === 'gym' ? 'bolt_fill' : 'play_fill')}</span>`;
      trail = '<span class="r-dur green">Now</span>';
      at = `<span class="r-at num">${b.plannedStart || ''}</span>`;
    } else if (b.kind === 'gym') {
      lead = `<span class="r-ic gym">${icon('bolt_fill')}</span>`;
    }
    if (!isDone && b.origStart && b.origStart !== b.plannedStart) notes.push(`moved from <s class="moved">${b.origStart}</s>`);
    if (!isDone && b.plannedStart && L.hm(b.plannedStart) + b.expectedMin > L.bedMinOf(S.settings)) notes.push('<span class="red">after bedtime</span>');
    if (b.fixed && !isDone) notes.push('fixed time');
    if (b.retro) notes.push('backfilled');
    return `<li class="swipeout row ${isDone ? 'is-done' : ''}" data-id="${b.id}">
      <div class="swipeout-content"><a class="row-in" data-block="${b.id}">
        ${lead}${at}<span class="r-txt"><span class="r-title">${esc(b.title)}</span>${notes.length ? `<span class="r-sub">${notes.join(' · ')}</span>` : ''}</span>${trail}
      </a></div>
      ${isDone ? '' : `<div class="swipeout-actions-left"><a class="swipeout-overswipe sw-done" data-complete="${b.id}">${icon('checkmark_alt')}Done</a></div>`}
      <div class="swipeout-actions-right"><a class="swipeout-overswipe sw-del" data-remove="${b.id}">${icon('trash_fill')}Delete</a></div></li>`;
  }

  // wire the hold-and-roll spots of rows rendered into `root`
  function armRows(root) {
    root.querySelectorAll('[data-roll-start]').forEach((el) => {
      const b = S.blocks.find((x) => x.id === el.dataset.rollStart); if (!b) return;
      const now5 = () => Math.ceil(L.minOfDay(Store.now()) / 5) * 5;
      window.Roll.timeRoll(el, { exact: true, get: () => (b.plannedStart ? L.hm(b.plannedStart) : now5()), set: (m) => UI.applyTime(b, m, b.expectedMin) });
    });
    root.querySelectorAll('[data-roll-dur]').forEach((el) => {
      const b = S.blocks.find((x) => x.id === el.dataset.rollDur); if (!b) return;
      window.Roll.durRoll(el, { get: () => b.expectedMin, set: (m) => UI.applyTime(b, null, m) });
    });
  }

  // long-press a timed row, then drag it up or down: the times follow the new order
  function armReorder(ul) {
    let rd = null;
    const rows = () => [...ul.querySelectorAll(':scope > li.row')];
    ul.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('li.row');
      if (!li || e.target.closest('.roll, .swipeout-actions-left, .swipeout-actions-right')) return;
      const b = S.blocks.find((x) => x.id === li.dataset.id);
      if (!b || !b.plannedStart || b.doneAt || b.runningSince || b.fixed) return;
      rd = { li, y0: e.clientY, x0: e.clientX, on: false };
      rd.timer = setTimeout(() => {
        if (!rd) return;
        rd.on = true; li.classList.add('lift'); Sound.pop();
        window.app.swipeout.close(li);
      }, 420);
    });
    const move = (e) => {
      if (!rd) return;
      if (!rd.on) { if (Math.abs(e.clientY - rd.y0) + Math.abs(e.clientX - rd.x0) > 8) { clearTimeout(rd.timer); rd = null; } return; }
      const li = rd.li, list = rows(), i = list.indexOf(li);
      let dy = e.clientY - rd.y0;
      const prev = list[i - 1], next = list[i + 1];
      if (prev && dy < -prev.offsetHeight / 2) { ul.insertBefore(li, prev); rd.y0 -= prev.offsetHeight; dy += prev.offsetHeight; Sound.tap(); }
      else if (next && dy > next.offsetHeight / 2) { ul.insertBefore(next, li); rd.y0 += next.offsetHeight; dy -= next.offsetHeight; Sound.tap(); }
      li.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      if (!rd) return;
      clearTimeout(rd.timer);
      const r = rd; rd = null;
      if (!r.on) return;
      r.li.classList.remove('lift'); r.li.style.transform = '';
      const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      r.li.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => r.li.removeEventListener('click', eat, { capture: true }), 400);
      const order = rows().map((x) => x.dataset.id);
      const out = L.reorder(S.blocks, Store.today(), order);
      const changed = S.blocks.filter((b) => b.id in out && L.hmStr(out[b.id]) !== b.plannedStart).map((b) => ({ ...b, plannedStart: L.hmStr(out[b.id]) }));
      if (changed.length) Store.saveBlocks(changed); else renderToday();
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    ul.addEventListener('touchmove', (e) => { if (rd && rd.on) e.preventDefault(); }, { passive: false });
  }

  // ---------- Today ----------
  const ARC = Math.PI * 118; // half-ring length (r = 118)
  function idleMinutesNow(n, key, day) {
    const marks = [day.upAt, day.lastIdleAckAt, ...S.blocks.filter((b) => b.date === key).flatMap((b) => [b.doneAt, b.pausedAt])].filter(Boolean).map((x) => new Date(x));
    return marks.length ? Math.max(0, (n - Math.max(...marks)) / L.MIN) : 0;
  }

  function gaugeHTML(n) {
    const r = running(), key = Store.today(), day = S.days[key] || {};
    let p = 0, cls = '', big = '', title = '', sub = '', extra = '';
    const snoozeUntil = S.settings.idleSnoozeUntil ? new Date(S.settings.idleSnoozeUntil) : null;
    const isSnoozed = snoozeUntil && snoozeUntil > n;

    if (day.finishedAt) {
      const pr = day.stats ? (day.stats.prod != null ? day.stats.prod : day.stats.workMin / S.settings.workGoalMin) : 0;
      p = Math.min(1, pr);
      cls = 'done'; big = `${Math.round(pr * 100)}%`;
      title = 'Day finished'; sub = day.bedAt ? `In bed since ${timeOf(day.bedAt)}` : 'Time for your night routine';
    } else if (r) {
      const act = L.actualMs(r, n), exp = r.expectedMin * L.MIN, over = act > exp;
      p = Math.min(1, act / exp); cls = over ? 'over' : r.kind === 'gym' ? 'gym' : '';
      ({ big, sub } = timerText(r, n));
      title = esc(r.title);
    } else if (isSnoozed) {
      cls = 'snoozed';
      big = L.fmtDur(Math.max(1, (snoozeUntil - n) / L.MIN));
      title = esc(S.settings.idleSnoozeReason || 'Alerts paused');
      sub = `<a data-action="idle-snooze">Until ${timeOf(snoozeUntil)} · Tap to change</a>`;
      extra = `<div class="idle-tools"><button class="pill" data-action="idle-snooze">${icon('bell_slash_fill')}Resume / Change</button><button class="pill" data-action="idle-explain">${icon('clock_fill')}Log task</button></div>`;
    } else {
      const idle = idleMinutesNow(n, key, day);
      cls = 'idle';
      big = idle >= 1 ? `<span class="${idle >= 5 ? 'red' : ''}">${L.fmtDur(idle)}</span>` : '0:00';
      title = idle >= 5 ? 'Idle — What are you doing?' : 'Nothing running';
      const next = dayBlocks(key).find((b) => !b.doneAt && b.kind === 'task');
      sub = next ? `Next: ${esc(next.title)}` : 'Add a task to start';
      extra = `<div class="idle-tools">
        <button class="pill ${idle >= 5 ? 'red' : ''}" data-action="idle-explain">${icon('arrow_counterclockwise')}Forgot to start / Explain</button>
        <button class="pill" data-action="idle-snooze">${icon('moon_zzz_fill')}Pause alerts (Nap/Class)</button>
      </div>`;
    }
    return `<div class="hgauge gauge-3d ${cls}" id="gauge">
      <svg viewBox="0 0 260 140" aria-hidden="true">
        <defs>
          <linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="var(--g1)"/><stop offset="1" stop-color="var(--g2)"/></linearGradient>
          <filter id="gglow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="var(--g1)" flood-opacity="0.45"/></filter>
        </defs>
        <path class="g-track" d="M12 130 A118 118 0 0 1 248 130"/>
        <path class="g-fill" id="g-fill" filter="url(#gglow)" d="M12 130 A118 118 0 0 1 248 130" stroke-dasharray="${ARC}" stroke-dashoffset="${ARC * (1 - p)}"/>
      </svg>
      <div class="g-in"><div class="g-big num" id="g-big" ${r && !day.finishedAt ? 'data-action="timer-mode"' : !r && !day.finishedAt ? 'data-action="idle-explain"' : ''}>${big}</div><div class="g-title">${title}</div><div class="g-sub num" id="g-sub">${sub}</div></div>
    </div>${extra}`;
  }

  // The running task's number: time spent (18:07) or time left (11:53), tap to switch; over time is +3:10 in both.
  function timerText(r, n) {
    const act = L.actualMs(r, n), exp = r.expectedMin * L.MIN;
    if (act > exp) return { big: `+${L.fmtTimer(act - exp)}`, sub: `<a class="red" data-extend="${r.id}">over ${L.fmtDur(r.expectedMin)} · Tap to extend</a>` };
    if (S.settings.timerMode === 'left') return { big: L.fmtTimer(exp - act), sub: `left of ${L.fmtDur(r.expectedMin)} · done ${L.hmStr(L.minOfDay(n) + (exp - act) / L.MIN)}` };
    return { big: L.fmtTimer(act), sub: `of ${L.fmtDur(r.expectedMin)} · done ${L.hmStr(L.minOfDay(n) + (exp - act) / L.MIN)}` };
  }
  function toggleTimer() {
    Store.setKV('settings', { ...S.settings, timerMode: S.settings.timerMode === 'left' ? 'spent' : 'left' });
    Sound.tap();
  }

  function actionsHTML() {
    const r = running(), key = Store.today(), day = S.days[key] || {};
    const btn = (action, ic, label, primary, data = '') => `<button class="act ${primary ? 'primary' : ''}" ${data || `data-action="${action}"`}><span>${icon(ic)}</span>${label}</button>`;
    if (day.finishedAt) {
      return `<div class="acts">${btn('reveal', 'chart_bar_alt_fill', 'Results', true)}${btn('plan-vs-actual', 'arrow_left_right', 'Plan vs Real')}${day.bedAt ? '' : btn('night', 'moon_fill', 'Night')}${btn('more', 'ellipsis', 'More')}</div>`;
    }
    const next = dayBlocks(key).find((b) => !b.doneAt && !b.runningSince && b.kind === 'task');
    const first = r ? btn('', 'checkmark_alt', 'Done', true, `data-done="${r.id}"`)
      : next ? btn('', 'play_fill', 'Start', true, `data-start="${next.id}"`) : btn('new-task', 'plus', 'Add', true);
    return `<div class="acts">${first}
      ${r ? btn('', 'pause_fill', 'Pause', false, `data-pause="${r.id}"`) : ''}
      ${r ? btn('', 'plus_circle_fill', 'Extend', false, `data-extend="${r.id}"`) : ''}
      ${r ? btn('focus', 'eye_fill', 'Focus') : ''}
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
    const daysLeft = Math.max(0, Math.floor((rel - n) / 86400000));
    const open = all.filter((b) => !b.doneAt);
    const list = showAll ? all : open.filter((b) => !b.runningSince).slice(0, 3);
    const tl = h.todayLeftMs / L.MIN;
    const hc = heroContent(n, h, all, left, daysLeft);
    // 1h before sleep time prominent Finish Day banner (Report #9)
    const showFinishBanner = !day.finishedAt && day.upAt && tl <= 60;
    const finishBannerHTML = showFinishBanner ? `
      <div class="finish-banner" data-action="finish">
        <div class="fb-ic">${icon('moon_stars_fill')}</div>
        <div class="fb-txt">
          <b>${tl <= 0 ? 'Past bedtime' : `${L.fmtDur(tl)} until sleep (${S.settings.bed})`}</b>
          <span>Tap to finish the day & review Plan vs. Reality</span>
        </div>
        <button class="btn fill fb-btn">Finish Day</button>
      </div>` : '';

    $('#today').innerHTML = `
      <div class="today-grid">
        <div class="today-col today-left">
          <div class="h-hero" id="h-hero">
            <div class="${hc.numCls}" id="h-num" data-action="hero-mode" title="Tap to switch view">${hc.numHTML}</div>
            <div class="h-sub" id="h-sub">${hc.subHTML}</div>
            <div class="h-pills">
              <span class="pill" data-action="hero-mode">${icon('flag_fill')}${daysLeft} days to release</span>
              <span class="pill ${left ? '' : 'green'}">${icon(left ? 'list_bullet' : 'checkmark_alt')}${left ? `${left} task${left > 1 ? 's' : ''} left` : 'All done'}</span>
            </div>
          </div>
          ${finishBannerHTML}
          ${gaugeHTML(n)}
          ${actionsHTML()}
          <div class="sec-head"><h3>So far</h3></div>
          <div class="bars">
            ${barRow('clock_fill', 'var(--green)', 'Work', `${L.fmtDur(st.workMin)} / ${L.fmtDur(S.settings.workGoalMin)}`, st.workMin / S.settings.workGoalMin)}
            ${barRow('checkmark_alt', 'var(--teal)', 'Tasks', `${st.tasksDone} of ${st.tasksPlanned}`, st.tasksPlanned ? st.tasksDone / st.tasksPlanned : 0)}
            ${barRow('hourglass', 'var(--red)', 'Wasted', L.fmtDur(st.wastedMin), st.wastedMin / 180, st.wastedMin > 60 ? 'red' : '')}
          </div>
        </div>
        <div class="today-col today-right">
          <div class="sec-head"><h3>${showAll ? 'Today' : 'Up next'}</h3>${all.length > 3 || showAll ? `<a data-action="toggle-all">${showAll ? 'Less' : `See all ${all.length}`}</a>` : ''}</div>
          ${list.length ? `<div class="list rows" id="upnext"><ul>${list.map((b) => rowHTML(b, n)).join('')}</ul></div>` : ''}
          ${quickHTML()}
        </div>
      </div>
      <div style="height:28px"></div>`;
    renderStreak();
    const un = $('#upnext ul'); if (un) { armRows(un); armReorder(un); }
    const g = $('#gauge'); if (g && tilt3D) tilt3D(g, 8);
    armQuick();
  }

  // ---------- fast add: title, start, length (end worked out live), nothing else ----------
  const qa = { open: false, title: '', start: null, dur: 30, cat: null };
  function openToday() {
    const key = Store.today();
    return S.blocks.filter((b) => b.date === key && b.plannedStart && !b.doneAt);
  }
  function qaAutoStart() {
    const n = Store.now(), nowMin = Math.ceil(L.minOfDay(n) / 5) * 5;
    let end = nowMin;
    for (const b of openToday()) {
      const e = b.runningSince ? L.minOfDay(n) + Math.max(0, b.expectedMin - L.actualMs(b, n) / L.MIN) : L.hm(b.plannedStart) + b.expectedMin;
      end = Math.max(end, Math.ceil(e / 5) * 5);
    }
    return Math.min(end, 23 * 60 + 55);
  }
  const qaStart = () => (qa.start == null ? qaAutoStart() : qa.start);
  function qaClash(s, d) {
    const hit = openToday().find((b) => { const bs = L.hm(b.plannedStart); return s < bs + b.expectedMin && s + d > bs; });
    if (hit) return `Overlaps ${esc(hit.title)} ${hit.plannedStart}–${L.hmStr(L.hm(hit.plannedStart) + hit.expectedMin)}`;
    if (s + d > L.bedMinOf(S.settings)) return `Ends after bedtime (${S.settings.bed})`;
    return '';
  }
  function quickHTML() {
    if (!qa.open) return `<div class="qa"><a class="qa-add" id="qa-add">${icon('plus')}<span>Add a task</span></a></div>`;
    const c = window.Cats.byId(qa.cat) || window.Cats.last(), s = qaStart(), warn = qaClash(s, qa.dur);
    return `<div class="qa open">
      <input id="qa-t" type="text" placeholder="What are you doing next?" autocomplete="off" enterkeyhint="done" value="${esc(qa.title)}">
      <div class="qa-row">
        <span class="qa-cat" id="qa-cat" style="--c:${window.Cats.hex(c)}">${esc(c.name)}</span>
        <span class="qa-time"><span class="qa-s num" id="qa-s">${L.hmStr(s)}</span><span class="qa-arrow">→</span><span class="qa-e num" id="qa-e">${L.hmStr(s + qa.dur)}</span></span>
        <span class="qa-d num" id="qa-d">${L.fmtDur(qa.dur)}</span>
      </div>
      <div class="qa-warn" id="qa-w">${warn}</div>
      <div class="qa-btns"><a class="qa-cancel" id="qa-x">Cancel</a><button class="btn fill qa-go" id="qa-go">Add</button></div>
    </div>`;
  }
  function qaRefresh() {
    const s = qaStart();
    const qs = $('#qa-s'), qe = $('#qa-e'), qd = $('#qa-d'), qw = $('#qa-w');
    if (qs) qs.textContent = L.hmStr(s);
    if (qe) qe.textContent = L.hmStr(s + qa.dur);
    if (qd) qd.textContent = L.fmtDur(qa.dur);
    if (qw) qw.innerHTML = qaClash(s, qa.dur);
  }
  function armQuick() {
    const add = $('#qa-add');
    if (add) {
      let hold = null, held = false;
      add.addEventListener('pointerdown', () => { held = false; hold = setTimeout(() => { held = true; Sound.pop(); UI.taskEditor({ date: Store.today() }); }, 500); });
      const cancel = () => clearTimeout(hold);
      add.addEventListener('pointerup', cancel); add.addEventListener('pointerleave', cancel); add.addEventListener('pointercancel', cancel);
      add.addEventListener('click', () => { if (held) return; qa.open = true; qa.cat = qa.cat || window.Cats.last().id; renderToday(); const t = $('#qa-t'); if (t) t.focus(); });
      return;
    }
    if (!qa.open) return;
    const t = $('#qa-t');
    t.addEventListener('input', () => { qa.title = t.value; });
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); qaAdd(); } });
    const updStart = (m) => { qa.start = m; qaRefresh(); };
    const updDur = (m) => { qa.dur = m; qaRefresh(); };
    const updCat = (id) => {
      qa.cat = id;
      const c = window.Cats.byId(id);
      const cel = $('#qa-cat');
      if (c && cel) {
        cel.textContent = c.name;
        cel.style.setProperty('--c', window.Cats.hex(c));
      }
    };
    window.Roll.timeRoll($('#qa-s'), { get: qaStart, onChange: updStart, set: updStart });
    window.Roll.durRoll($('#qa-d'), { get: () => qa.dur, onChange: updDur, set: updDur });
    window.Roll.catRoll($('#qa-cat'), { get: () => qa.cat, set: updCat });
    $('#qa-x').addEventListener('click', () => { Object.assign(qa, { open: false, title: '', start: null }); renderToday(); });
    $('#qa-go').addEventListener('click', qaAdd);
  }
  function qaAdd() {
    const title = qa.title.trim();
    if (!title) { const t = $('#qa-t'); t.focus(); t.classList.add('shake'); setTimeout(() => t.classList.remove('shake'), 400); return; }
    const key = Store.today(), c = window.Cats.byId(qa.cat) || window.Cats.last();
    const b = { id: Store.uid(), date: key, kind: window.Cats.kindOf(c), cat: c.id, title, plannedStart: L.hmStr(qaStart()), expectedMin: qa.dur,
      step: (UI.stepFor(key) || {}).n || null, fixed: false };
    if (document.activeElement) document.activeElement.blur();
    Object.assign(qa, { open: false, title: '', start: null, dur: 30 });
    if (S.settings.lastCat !== c.id) Store.setKV('settings', { ...S.settings, lastCat: c.id });
    Store.saveBlock(b);
    Sound.pop();
  }

  function renderStreak() {
    const key = Store.today();
    $('.streak').innerHTML = `${flameSVG(L.combo(S.blocks, key), 20)}<span class="num">${L.streak(S.days, key)}</span>`;
  }

  // Per-second update of the moving numbers + local idle nudge check.
  let lastLocalIdleNudge = 0;
  function tickToday() {
    const n = Store.now(), r = running(), key = Store.today(), day = S.days[key] || {};
    const h = L.hoursLeft(n, S.settings);
    const all = dayBlocks(key);
    const left = all.filter((b) => b.kind === 'task' && !b.doneAt).length;
    const rel = new Date(S.settings.releaseAt);
    const daysLeft = Math.max(0, Math.floor((rel - n) / 86400000));
    const hc = heroContent(n, h, all, left, daysLeft);
    const hn = $('#h-num'), hs = $('#h-sub');
    if (hn) {
      hn.className = hc.numCls;
      if (hn.innerHTML !== hc.numHTML) hn.innerHTML = hc.numHTML;
    }
    if (hs && hs.innerHTML !== hc.subHTML) hs.innerHTML = hc.subHTML;

    if (!r) {
      // Update idle counter & trigger local nudge if awake, not snoozed, and idle >= 2 min
      const snoozeUntil = S.settings.idleSnoozeUntil ? new Date(S.settings.idleSnoozeUntil) : null;
      const isSnoozed = snoozeUntil && snoozeUntil > n;
      if (!day.finishedAt && day.upAt && !isSnoozed) {
        const idle = idleMinutesNow(n, key, day);
        const gb = $('#g-big');
        if (gb && $('#gauge.idle')) {
          gb.innerHTML = idle >= 1 ? `<span class="${idle >= 5 ? 'red' : ''}">${L.fmtDur(idle)}</span>` : '0:00';
        }
        // Local chime/nudge every 2 minutes when idle >= 2 min
        if (idle >= 2 && Date.now() - lastLocalIdleNudge >= 120000) {
          lastLocalIdleNudge = Date.now();
          if (window.FX && window.FX.Sound && window.FX.Sound.nudge) window.FX.Sound.nudge();
        }
      }
      return;
    }
    const g = $('#gauge'); if (!g) return;
    const act = L.actualMs(r, n), exp = r.expectedMin * L.MIN, over = act > exp;
    if (over !== g.classList.contains('over')) return renderToday();
    const tt = timerText(r, n);
    $('#g-big').textContent = tt.big;
    $('#g-sub').innerHTML = tt.sub;
    $('#g-fill').setAttribute('stroke-dashoffset', ARC * (1 - Math.min(1, act / exp)));
  }

  // ---------- full-screen task celebration (all categories + 3D tilt card) ----------
  function celebrate(ok, diffMin, comboN, block) {
    const el = $('#celebrate');
    const streakN = L.streak(S.days, Store.today());
    const act = block && block.actualMs ? Math.round(block.actualMs / L.MIN) : 0;
    const expMin = block && block.expectedMin ? block.expectedMin : act - diffMin;
    const pct = expMin ? Math.round((-diffMin / expMin) * 100) : 0;
    const cat = block ? window.Cats.of(block) : null;
    const catBadge = cat ? `<span class="qa-cat" style="--c:${window.Cats.hex(cat)};margin-bottom:6px">${esc(cat.name)}</span>` : '';
    const next = dayBlocks(Store.today()).find((b) => !b.doneAt && !b.runningSince && (!block || b.id !== block.id));
    const lvl = ok ? Math.min(7, comboN) : 0;
    const segs = Array.from({ length: 7 }, (_, i) => `<i class="${i < lvl ? 'on' : ''}" style="animation-delay:${0.5 + i * 0.07}s"></i>`).join('');
    const meter = ok
      ? (comboN >= 7 ? 'Blue flame. Keep it going.' : `${7 - comboN} more on time for the blue flame`)
      : 'Combo back to 0';
    el.innerHTML = `<div class="cel-full ${ok ? 'win' : 'lose'}">
      <canvas id="confetti"></canvas>
      <div class="cel-center" id="cel-card">
        ${catBadge}
        <div class="cel-flame">${flameSVG(lvl, ok ? 120 : 80)}</div>
        <h1 class="cel-title">${ok ? (comboN >= 3 ? `${comboN} in a row!` : 'Crushed it!') : 'Done, but late'}</h1>
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
    const card = el.querySelector('#cel-card');
    if (card && tilt3D) tilt3D(card, 14);
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
    prod: { label: 'Productivity', short: 'Prod.', color: 'var(--accent)', get: (st) => prodOf(st) * 100, fmt: (v) => `${Math.round(v)}%`, goal: 75, goalLabel: 'streak 75%', target: 100 },
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
    const first = rows.findIndex((r) => !r.empty);
    return first > 0 ? rows.slice(Math.min(first, rows.length - 2)) : rows;
  }
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
  const W = 360, H = 170, PL = 18, PR = 18, PT = 14, PB = 22;
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
      ${goal ? `<line x1="${PL}" x2="${W - PR}" y1="${y(goal)}" y2="${y(goal)}" class="h-goal"/><text x="${PL}" y="${y(goal) + 13}" class="h-lbl">${M.goalLabel}</text>` : ''}
      <path d="${area}" fill="url(#hg)"/>
      <path class="h-line" d="${d}" fill="none" stroke="${M.color}" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="5" fill="${M.color}" stroke="#000" stroke-width="2.5"/>
      ${dayLabels(rows, x)}
    </svg>`;
  }
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
        ${better == null ? '' : `<div class="h-pills"><span class="pill ${better ? 'green' : 'red'}">${icon(better ? 'arrow_up_right' : 'arrow_down_right')}${better ? 'Better than yesterday' : 'Worse than yesterday'}</span></div>`}
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

  Object.assign(window.UI, { rowHTML, armRows, renderToday, renderStreak, tickToday, celebrate, renderPlan, renderHistory, toggleTimer, timerText, toggleHeroMode });
})();
