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
    if (S.settings.idleSnoozeUntil) Store.setKV('settings', { ...S.settings, idleSnoozeUntil: null });
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
    const act = L.actualMs(b, n) || b.expectedMin * L.MIN;
    const nb = { ...b, actualMs: act, runningSince: null, doneAt: n.toISOString() };
    Store.saveBlock(nb);
    const diffMin = Math.round((nb.actualMs - nb.expectedMin * L.MIN) / L.MIN);
    window.UI.celebrate(L.onTime(nb), diffMin, L.combo(S.blocks, nb.date), nb);
  }
  // swipe right: finish it. A task that never ran counts its planned time (it was done off the timer) and celebrates.
  function complete(id) {
    const b = S.blocks.find((x) => x.id === id); if (!b || b.doneAt) return;
    if (b.runningSince) return done(id);
    const n = Store.now();
    const nb = { ...b, actualMs: b.actualMs || b.expectedMin * L.MIN, runningSince: null, doneAt: n.toISOString() };
    Store.saveBlock(nb);
    const diffMin = Math.round((nb.actualMs - nb.expectedMin * L.MIN) / L.MIN);
    window.UI.celebrate(L.onTime(nb), diffMin, L.combo(S.blocks, nb.date), nb);
  }
  // swipe left: delete, with 4 s to take it back
  function remove(id) {
    const b = S.blocks.find((x) => x.id === id); if (!b) return;
    Store.deleteBlock(id);
    undoToast(`Deleted ${b.title}`, () => Store.saveBlock(b));
  }
  function undoToast(text, onUndo) {
    window.app.toast.create({
      text: esc(text), closeButton: true, closeButtonText: 'Undo', closeTimeout: 4000, cssClass: 'undo-toast',
      on: { closeButtonClick: onUndo },
    }).open();
  }
  // New start and/or length for a block; everything after it on that day slides (fixed blocks stay as walls).
  function applyTime(b, newStart, newLen) {
    const ps = newStart == null ? b.plannedStart : L.hmStr(newStart);
    if (!ps) { Store.saveBlock({ ...b, expectedMin: newLen }); return; }
    const orig = b.origStart || b.plannedStart || ps;
    const blocks = S.blocks.map((x) => (x.id === b.id ? { ...x, plannedStart: x.plannedStart || ps } : x));
    const out = L.ripple(blocks, b.date, b.id, L.hm(ps), newLen);
    const changed = [];
    for (const x of S.blocks) {
      if (x.date !== b.date || !(x.id in out)) continue;
      const ns = L.hmStr(out[x.id]);
      if (x.id === b.id) changed.push({ ...x, plannedStart: ns, expectedMin: newLen, origStart: orig });
      else if (ns !== x.plannedStart) changed.push({ ...x, origStart: x.origStart || x.plannedStart, plannedStart: ns });
    }
    if (!changed.some((x) => x.id === b.id)) changed.push({ ...b, plannedStart: ps, expectedMin: newLen, origStart: orig });
    Store.saveBlocks(changed);
  }
  function undo(id) {
    const b = S.blocks.find((x) => x.id === id); if (b) Store.saveBlock({ ...b, doneAt: null });
  }
  function startGym() {
    const key = Store.today();
    const planned = S.blocks.find((b) => b.date === key && b.kind === 'gym' && !b.doneAt);
    if (planned) return start(planned.id);
    const b = { id: Store.uid(), date: key, kind: 'gym', cat: 'gym', title: 'Gym', plannedStart: null, expectedMin: 60, fixed: false };
    Store.saveBlock(b); start(b.id);
  }

  function blockMenu(b) {
    const app = window.app, run = !!b.runningSince, isDone = !!b.doneAt;
    const buttons = [];
    if (!isDone && !run) buttons.push({ text: b.kind === 'gym' ? 'Start Gym' : 'Start', bold: true, onClick: () => start(b.id) });
    if (run) {
      buttons.push({ text: 'Done', bold: true, onClick: () => done(b.id) });
      buttons.push({ text: 'Extend time / What’s left…', onClick: () => extendSheet(b) });
      buttons.push({ text: 'Pause', onClick: () => pause(b.id) });
    }
    if (!isDone && !run && b.actualMs) buttons.push({ text: 'Mark Done', onClick: () => done(b.id) });
    if (isDone) buttons.push({ text: 'Mark Not Done', onClick: () => undo(b.id) });
    buttons.push({ text: 'Edit', onClick: () => taskEditor({ block: b }) });
    buttons.push({ text: 'Delete', color: 'red', onClick: () => Store.deleteBlock(b.id) });
    app.actions.create({ buttons: [[{ text: esc(b.title), label: true }, ...buttons], [{ text: 'Cancel', bold: true }]] }).open();
  }

  function stepMenu(nStep) {
    const s = S.steps.find((x) => x.n === nStep); if (!s) return;
    window.app.actions.create({ buttons: [[{ text: `Step ${s.n} · ${esc(s.title)}`, label: true },
      { text: s.done ? 'Mark Not Done' : 'Mark Done', bold: true, onClick: () => Store.setKV('steps', S.steps.map((x) => (x.n === nStep ? { ...x, done: !x.done } : x))) }],
      [{ text: 'Cancel', bold: true }]] }).open();
  }

  // ---------- Extend Task & "What do I have left to do?" sheet (Report #9) ----------
  function extendSheet(blockOrId) {
    const b0 = typeof blockOrId === 'string' ? S.blocks.find((x) => x.id === blockOrId) : blockOrId;
    if (!b0) return;
    const app = window.app;
    let addMin = 15;
    const popup = app.popup.create({
      swipeToClose: true, push: true,
      content: `<div class="popup extend-popup"><div class="view"><div class="page">
        <div class="navbar"><div class="navbar-bg"></div><div class="navbar-inner">
          <div class="left"><a class="link popup-close">Cancel</a></div>
          <div class="title">Extend Task</div>
          <div class="right"><a class="link" data-ext-save style="font-weight:600">Extend</a></div>
        </div></div>
        <div class="page-content" id="ext-body"></div>
      </div></div></div>`,
      on: { closed(p) { setTimeout(() => p.destroy()); } },
    });
    const body = popup.el.querySelector('#ext-body');
    const nowMin = () => Math.round(L.minOfDay(Store.now()));
    function renderExt() {
      const b = S.blocks.find((x) => x.id === b0.id) || b0;
      const n = Store.now();
      const actMin = Math.round(L.actualMs(b, n) / L.MIN);
      const baseMin = Math.max(b.expectedMin, actMin);
      const newTotal = baseMin + addMin;
      const finishClock = L.hmStr(L.minOfDay(n) + (newTotal - actMin));
      const subs = b.subs || [];
      body.innerHTML = `
        <div class="ext-hero">
          <div class="ext-title">${esc(b.title)}</div>
          <div class="ext-sub num">Spent ${L.fmtDur(actMin)} · New total <b>${L.fmtDur(newTotal)}</b> · Done at <b class="green">${finishClock}</b></div>
          <div class="ext-chips">
            ${[10, 15, 30, 45, 60].map((m) => `<button class="pill ext-chip ${addMin === m ? 'green' : ''}" data-addm="${m}">+${m} min</button>`).join('')}
          </div>
        </div>
        <div class="block-title">What do you have left to do?</div>
        <div class="ext-subs-wrap" style="margin:0 16px">
          ${subs.length ? `<ul class="fo-subs">${subs.map((x) => `<li class="fs ${x.done != null ? 'done' : ''}">
            <a class="fs-chk" data-echk="${x.id}">${x.done != null ? '<i class="f7-icons">checkmark_alt</i>' : ''}</a>
            <div class="fs-main"><div class="fs-t">${esc(x.t)}</div>
              <div class="fs-time num"><span>${L.hmStr(x.s)} → ${L.hmStr(x.s + x.d)}</span> · <span>${L.fmtDur(x.d)}</span></div></div>
            <a class="fs-del" data-edel="${x.id}"><i class="f7-icons">xmark</i></a>
          </li>`).join('')}</ul>` : '<div class="empty" style="margin:0 0 12px">Break down what is left so you finish strong.</div>'}
          <div class="qa open fo-add" style="margin-top:12px">
            <input id="ext-sub-t" type="text" placeholder="Add remaining step…" autocomplete="off" enterkeyhint="done">
            <div class="qa-btns"><span></span><button class="btn fill qa-go" id="ext-sub-go">Add step</button></div>
          </div>
        </div>`;
      body.querySelectorAll('[data-addm]').forEach((btn) => btn.addEventListener('click', () => {
        addMin = +btn.dataset.addm;
        Sound.tap();
        renderExt();
      }));
      body.querySelectorAll('[data-echk]').forEach((el) => el.addEventListener('click', () => {
        const cur = S.blocks.find((x) => x.id === b.id) || b;
        const list = (cur.subs || []).map((x) => (x.id === el.dataset.echk ? { ...x, done: x.done == null ? nowMin() : null } : x));
        Store.saveBlock({ ...cur, subs: list });
        Sound.check();
        renderExt();
      }));
      body.querySelectorAll('[data-edel]').forEach((el) => el.addEventListener('click', () => {
        const cur = S.blocks.find((x) => x.id === b.id) || b;
        Store.saveBlock({ ...cur, subs: (cur.subs || []).filter((x) => x.id !== el.dataset.edel) });
        Sound.tap();
        renderExt();
      }));
      const inp = body.querySelector('#ext-sub-t');
      const addSub = () => {
        const title = (inp.value || '').trim();
        if (!title) { inp.focus(); return; }
        const cur = S.blocks.find((x) => x.id === b.id) || b;
        const list = cur.subs || [];
        const s = list.length ? Math.max(nowMin(), list[list.length - 1].s + list[list.length - 1].d) : nowMin();
        Store.saveBlock({ ...cur, subs: [...list, { id: Store.uid(), t: title, s, d: 15, done: null }] });
        Sound.pop();
        renderExt();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
      body.querySelector('#ext-sub-go').addEventListener('click', addSub);
    }
    popup.el.querySelector('[data-ext-save]').addEventListener('click', () => {
      const b = S.blocks.find((x) => x.id === b0.id) || b0;
      const actMin = Math.round(L.actualMs(b, Store.now()) / L.MIN);
      const newLen = Math.max(b.expectedMin, actMin) + addMin;
      applyTime(b, null, newLen);
      Sound.check();
      popup.close();
    });
    renderExt();
    popup.open();
  }

  // ---------- Quick Sleep / Wake Customizer (Report #9) ----------
  function sleepWakeSheet() {
    const app = window.app;
    const popup = app.popup.create({
      swipeToClose: true, push: true,
      content: `<div class="popup"><div class="view"><div class="page">
        <div class="navbar"><div class="navbar-bg"></div><div class="navbar-inner">
          <div class="left"><a class="link popup-close">Cancel</a></div>
          <div class="title">Sleep & Wake</div>
          <div class="right"><a class="link popup-close" style="font-weight:600">Done</a></div>
        </div></div>
        <div class="page-content">
          <div class="block-title">Customize Schedule</div>
          <div class="list list-strong list-dividers inset ilabels"><ul>
            <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Wake up</div><div class="item-input-wrap"><input type="time" name="wake" value="${S.settings.wake}"></div></div></li>
            <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Bedtime</div><div class="item-input-wrap"><input type="time" name="bed" value="${S.settings.bed}"></div></div></li>
          </ul></div>
          <div class="block-footer" style="margin:0 32px">Crunch surfaces "Finish the Day" 1 hour before your bedtime and subtracts sleep hours from your release countdown.</div>
        </div></div></div></div>`,
      on: { closed(p) { setTimeout(() => p.destroy()); } },
    });
    popup.el.querySelectorAll('input[type=time]').forEach((inp) => inp.addEventListener('change', () => {
      Store.setKV('settings', { ...S.settings, [inp.name]: inp.value });
      Sound.tap();
    }));
    popup.open();
  }

  // ---------- Retroactive Idle Explanation & Backfill (Report #3) ----------
  function idleExplainSheet() {
    const app = window.app, n = Store.now(), key = Store.today(), day = S.days[key] || {};
    const marks = [day.upAt, ...S.blocks.filter((b) => b.date === key).flatMap((b) => [b.doneAt, b.pausedAt])].filter(Boolean).map((x) => new Date(x));
    const lastMark = marks.length ? new Date(Math.max(...marks)) : new Date(n.getTime() - 30 * L.MIN);
    const idleMin = Math.max(5, Math.round((n - lastMark) / L.MIN));
    const startHm = `${L.pad(lastMark.getHours())}:${L.pad(lastMark.getMinutes())}`;
    const openTasks = dayBlocks(key).filter((b) => !b.doneAt);
    let mode = 'task'; // 'task' | 'break'
    let pickedId = openTasks[0] ? openTasks[0].id : 'new';
    let durMin = idleMin;
    let finishState = 'running'; // 'running' | 'done'

    const popup = app.popup.create({
      swipeToClose: true, push: true,
      content: `<div class="popup"><div class="view"><div class="page">
        <div class="navbar"><div class="navbar-bg"></div><div class="navbar-inner">
          <div class="left"><a class="link popup-close">Cancel</a></div>
          <div class="title">Idle ${L.fmtDur(idleMin)}</div>
          <div class="right"><a class="link" data-idle-save style="font-weight:600">Save</a></div>
        </div></div>
        <div class="page-content" id="idle-exp-body"></div>
      </div></div></div>`,
      on: { closed(p) { setTimeout(() => p.destroy()); } },
    });
    const body = popup.el.querySelector('#idle-exp-body');
    function renderBody() {
      body.innerHTML = `
        <div class="seg-wrap" style="margin-top:18px"><div class="segmented segmented-strong">
          <a class="button ${mode === 'task' ? 'button-active' : ''}" data-imode="task">Forgot to start task</a>
          <a class="button ${mode === 'break' ? 'button-active' : ''}" data-imode="break">Explain break / IRL</a>
          <span class="segmented-highlight"></span></div></div>
        <div class="block-footer" style="margin:10px 32px 6px">Idle since <b>${startHm}</b> (${L.fmtDur(idleMin)} ago)</div>
        ${mode === 'task' ? `
          <div class="block-title">Which task were you doing?</div>
          <div class="list list-strong list-dividers inset"><ul>
            ${openTasks.map((b) => `<li><label class="item-radio item-content"><input type="radio" name="itask" value="${b.id}" ${pickedId === b.id ? 'checked' : ''}><i class="icon icon-radio"></i><div class="item-inner"><div class="item-title">${esc(b.title)}</div><div class="item-after num">${L.fmtDur(b.expectedMin)}</div></div></label></li>`).join('')}
            <li><label class="item-radio item-content"><input type="radio" name="itask" value="new" ${pickedId === 'new' ? 'checked' : ''}><i class="icon icon-radio"></i><div class="item-inner"><div class="item-title green">+ New task…</div></div></label></li>
          </ul></div>
          <div class="list list-strong list-dividers inset ilabels" ${pickedId === 'new' ? '' : 'hidden'} id="inew-wrap"><ul>
            <li class="item-content item-input"><div class="item-inner"><div class="item-input-wrap"><input type="text" id="inew-title" placeholder="What were you working on?" class="title-in"></div></div></li>
          </ul></div>
          <div class="list list-strong list-dividers inset ilabels"><ul>
            <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Minutes spent</div><div class="item-input-wrap"><input type="number" id="idur-min" min="1" max="${idleMin + 120}" value="${durMin}"></div></div></li>
            <li><div class="item-content"><div class="item-inner"><div class="item-title">Status now</div><div class="item-after">
              <div class="segmented segmented-strong" style="width:190px">
                <a class="button ${finishState === 'running' ? 'button-active' : ''}" data-fstate="running">Still going</a>
                <a class="button ${finishState === 'done' ? 'button-active' : ''}" data-fstate="done">Finished</a>
              </div>
            </div></div></div></li>
          </ul></div>
        ` : `
          <div class="block-title">What was going on?</div>
          <div class="list list-strong list-dividers inset"><ul>
            <li class="item-content item-input"><div class="item-inner"><div class="item-input-wrap">
              <input type="text" id="ibreak-note" placeholder="e.g. Nap, Class, Family, Meal…" class="title-in">
            </div></div></li>
            <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Minutes to excuse</div><div class="item-input-wrap"><input type="number" id="ibreak-min" min="1" max="${idleMin}" value="${idleMin}"></div></div></li>
          </ul></div>
          <div class="block-footer" style="margin:0 32px">Excused idle time is logged on your daily timeline and won't count against you as Wasted time.</div>
        `}`;
      body.querySelectorAll('[data-imode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.imode; Sound.tap(); renderBody(); }));
      body.querySelectorAll('input[name="itask"]').forEach((r) => r.addEventListener('change', () => {
        pickedId = r.value;
        const w = body.querySelector('#inew-wrap');
        if (w) w.hidden = pickedId !== 'new';
      }));
      body.querySelectorAll('[data-fstate]').forEach((b) => b.addEventListener('click', () => { finishState = b.dataset.fstate; Sound.tap(); renderBody(); }));
    }
    popup.el.querySelector('[data-idle-save]').addEventListener('click', () => {
      if (mode === 'task') {
        const mins = Math.max(1, +(body.querySelector('#idur-min').value || idleMin));
        const creditedMs = mins * L.MIN;
        let target = openTasks.find((b) => b.id === pickedId);
        if (pickedId === 'new' || !target) {
          const title = (body.querySelector('#inew-title')?.value || '').trim() || 'Backfilled task';
          const c = window.Cats.last();
          target = {
            id: Store.uid(), date: key, kind: window.Cats.kindOf(c), cat: c.id, title,
            plannedStart: startHm, expectedMin: mins, actualMs: 0, fixed: false, retro: true,
          };
        }
        if (finishState === 'running') {
          stopAll(n, target.id);
          Store.saveBlock({ ...target, actualMs: (target.actualMs || 0) + creditedMs, runningSince: n.toISOString(), doneAt: null, retro: true });
          Sound.pop();
        } else {
          const nb = { ...target, actualMs: (target.actualMs || 0) + creditedMs, runningSince: null, doneAt: n.toISOString(), retro: true };
          Store.saveBlock(nb);
          const diffMin = Math.round((nb.actualMs - nb.expectedMin * L.MIN) / L.MIN);
          window.UI.celebrate(L.onTime(nb), diffMin, L.combo(S.blocks, nb.date), nb);
        }
      } else {
        const note = (body.querySelector('#ibreak-note')?.value || '').trim() || 'Break / Off-screen';
        const mins = Math.max(1, +(body.querySelector('#ibreak-min')?.value || idleMin));
        const logs = [...(day.idleLogs || []), { id: Store.uid(), at: lastMark.toISOString(), min: mins, note }];
        Store.patchDay(key, { idleExcusedMin: (day.idleExcusedMin || 0) + mins, idleLogs: logs });
        // Also touch a pausedAt marker on the day so the live idle counter resets from now
        Store.patchDay(key, { lastIdleAckAt: n.toISOString(), idleExcusedMin: (day.idleExcusedMin || 0) + mins, idleLogs: logs });
        Sound.check();
      }
      popup.close();
    });
    renderBody();
    popup.open();
  }

  // ---------- Temporary Snooze / Do Not Disturb for Idle Alerts (Report #5) ----------
  function idleSnoozeSheet() {
    const app = window.app, n = Store.now(), key = Store.today(), day = S.days[key] || {};
    const snoozed = S.settings.idleSnoozeUntil && new Date(S.settings.idleSnoozeUntil) > n;
    const setSnooze = (mins, reason) => {
      if (!mins) {
        Store.setKV('settings', { ...S.settings, idleSnoozeUntil: null, idleSnoozeReason: null });
        Sound.tap();
        return;
      }
      const until = new Date(n.getTime() + mins * L.MIN).toISOString();
      Store.setKV('settings', { ...S.settings, idleSnoozeUntil: until, idleSnoozeReason: reason || 'Paused' });
      Store.patchDay(key, {
        idleExcusedMin: (day.idleExcusedMin || 0) + Math.min(mins, 240),
        lastIdleAckAt: n.toISOString(),
      });
      Sound.check();
      app.toast.create({ text: `Idle alerts paused (${reason || L.fmtDur(mins)})`, closeTimeout: 2000, cssClass: 'undo-toast' }).open();
    };
    const buttons = [
      { text: 'Pause Idle Alerts (Nap / Class)', label: true },
      { text: '30 min (Quick break / Nap)', onClick: () => setSnooze(30, '30m Nap/Break') },
      { text: '1 hour (Class / Meeting)', onClick: () => setSnooze(60, '1h Class') },
      { text: '2 hours (Class / Nap)', onClick: () => setSnooze(120, '2h Class/Nap') },
      { text: 'Until I start a task', onClick: () => setSnooze(360, 'Paused until back') },
    ];
    if (snoozed) buttons.unshift({ text: 'Resume Idle Alerts Now', bold: true, color: 'green', onClick: () => setSnooze(0) });
    app.actions.create({ cssClass: 'more-menu', buttons: [buttons, [{ text: 'Cancel', bold: true }]] }).open();
  }

  // ---------- task editor (iOS "New Event" style popup) ----------
  function taskEditor({ block, date, start: startArg } = {}) {
    const app = window.app;
    const isNew = !block;
    const key = block ? block.date : date || Store.today();
    const Cats = window.Cats;
    const b = block ? { ...block } : {
      id: Store.uid(), date: key, kind: 'task', title: '', step: (stepFor(key) || {}).n || null,
      plannedStart: startArg || null, expectedMin: 30, fixed: false, cat: Cats.last().id,
    };
    if (!b.cat) b.cat = Cats.of(b).id;
    const DRAFT = 'crunch-task-draft';
    if (isNew) {
      try { const d = JSON.parse(localStorage.getItem(DRAFT)); if (d) Object.assign(b, d, startArg ? { plannedStart: startArg } : {}); } catch (e) { /* none */ }
    }
    let saved = false;
    const durText = (m) => L.fmtDur(m);
    const calcEndClock = (durMin, startStr, isTimed) => {
      const baseMin = isTimed && startStr ? L.hm(startStr) : Math.round(L.minOfDay(Store.now()));
      return L.hmStr(baseMin + (durMin || b.expectedMin));
    };
    const popup = app.popup.create({
      swipeToClose: false, push: true,
      content: `<div class="popup task-popup"><div class="view"><div class="page">
        <div class="navbar"><div class="navbar-bg"></div><div class="navbar-inner">
          <div class="left"><a class="link popup-close">Cancel</a></div>
          <div class="title">${isNew ? 'New Task' : 'Edit Task'}</div>
          <div class="right"><a class="link" data-save style="font-weight:600">${isNew ? 'Add' : 'Done'}</a></div></div></div>
        <div class="page-content">
          <div class="list list-strong list-dividers inset ilabels" style="margin-top:20px"><ul>
            <li class="item-content item-input"><div class="item-inner"><div class="item-input-wrap">
              <input type="text" name="title" placeholder="Title" value="${esc(b.title)}" autocomplete="off" class="title-in"></div></div></li>
            <li><div class="item-content"><div class="item-inner"><div class="item-title">Category</div><div class="item-after">
              <span class="cat-val" data-cat style="--c:${Cats.hex(Cats.byId(b.cat))}">${esc((Cats.byId(b.cat) || {}).name || '')}</span></div></div></div></li>
          </ul></div>
          <div class="list list-strong list-dividers inset"><ul>
            <li><a class="item-content item-link no-chevron" data-toggle="dur"><div class="item-inner"><div class="item-title">Duration</div><div class="item-after num"><span class="green" data-dur>${durText(b.expectedMin)}</span><span class="dur-end muted" data-dur-end style="margin-left:8px;font-size:14px">→ ${calcEndClock(b.expectedMin, b.plannedStart, !!b.plannedStart)}</span></div></div></a></li>
            <li class="r-wheel" data-wheel="dur" hidden><div id="pick-dur"></div></li>
            <li><div class="item-content"><div class="item-inner"><div class="item-title">Set a time</div><div class="item-after">
              <label class="toggle"><input type="checkbox" name="timed" ${b.plannedStart ? 'checked' : ''}><span class="toggle-icon"></span></label></div></div></div></li>
            <li data-row="start" ${b.plannedStart ? '' : 'hidden'}><a class="item-content item-link no-chevron" data-toggle="start"><div class="item-inner"><div class="item-title">Starts</div><div class="item-after green num" data-start>${b.plannedStart || '09:00'}</div></div></a></li>
            <li class="r-wheel" data-wheel="start" hidden><div id="pick-start"></div></li>
            <li><div class="item-content"><div class="item-inner"><div class="item-title">Fixed time</div><div class="item-after">
              <label class="toggle"><input type="checkbox" name="fixed" ${b.fixed ? 'checked' : ''}><span class="toggle-icon"></span></label></div></div></div></li>
          </ul></div>
          <div class="list list-strong list-dividers inset ilabels"><ul>
            <li class="item-content item-input"><div class="item-inner"><div class="item-title item-label">Date</div><div class="item-input-wrap">
              <input type="date" name="date" value="${key}"></div></div></li>
            <li><div class="item-content"><div class="item-inner"><div class="item-title">Step</div><div class="item-after">
              <span class="step-val" data-stepval>${b.step ? esc(stepTitle(b.step)) : 'None'}</span></div></div></div></li>
          </ul></div>
          ${isNew ? '' : '<div class="list list-strong list-dividers inset"><ul><li><a class="item-content item-link no-chevron" data-del><div class="item-inner"><div class="item-title red" style="width:100%;text-align:center">Delete Task</div></div></a></li></ul></div>'}
          <div class="block-footer" style="margin:0 32px;color:var(--label3)">"Fixed time" makes it a wall in the planner: other tasks flow around it.</div>
        </div></div></div></div>`,
      on: {
        opened(p) { if (isNew) { const t = p.el.querySelector('[name=title]'); t && t.focus(); } },
        closed(p) {
          if (isNew) {
            const title = p.el.querySelector('[name=title]').value.trim();
            try {
              if (saved || !title) localStorage.removeItem(DRAFT);
              else localStorage.setItem(DRAFT, JSON.stringify({ title, expectedMin: b.expectedMin, plannedStart: p.el.querySelector('[name=timed]').checked ? b.plannedStart : null, cat: b.cat, step: b.step, fixed: p.el.querySelector('[name=fixed]').checked }));
            } catch (e) { /* private mode */ }
          }
          pickers.forEach((x) => x.destroy()); setTimeout(() => p.destroy());
        },
      },
    });
    const el = popup.el;
    const pickers = [];
    if (isNew) el.querySelector('[name=title]').value = b.title || '';
    const updateEndPreview = () => {
      const isTimed = el.querySelector('[name=timed]').checked;
      const stStr = isTimed ? (b.plannedStart || el.querySelector('[data-start]').textContent) : null;
      const endEl = el.querySelector('[data-dur-end]');
      if (endEl) endEl.textContent = `→ ${calcEndClock(b.expectedMin, stStr, isTimed)}`;
    };
    const catEl = el.querySelector('[data-cat]');
    const setCat = (id) => { b.cat = id; const c = Cats.byId(id); catEl.textContent = c ? c.name : ''; catEl.style.setProperty('--c', Cats.hex(c)); };
    window.Roll.catRoll(catEl, { get: () => b.cat, set: setCat });
    const stepEl = el.querySelector('[data-stepval]');
    const setStep = (n) => { b.step = n || null; stepEl.textContent = n ? stepTitle(n) : 'None'; };
    window.Roll.attach(stepEl, {
      values: () => [0, ...S.steps.map((s) => s.n)], index: (vals) => Math.max(0, vals.indexOf(b.step || 0)),
      label: (n) => (n ? stepTitle(n) : 'None'), onChange: setStep, onEnd: setStep,
      onTap: () => app.actions.create({ cssClass: 'more-menu', buttons: [[{ text: 'None', onClick: () => setStep(0) },
        ...S.steps.map((s) => ({ text: `${s.n} · ${esc(s.title)}`, onClick: () => setStep(s.n) }))], [{ text: 'Cancel', bold: true }]] }).open(),
    });
    // duration + start: hold the value and roll (updates finish clock live!); a tap opens the full wheel
    const setDurVal = (m) => { b.expectedMin = m; el.querySelector('[data-dur]').textContent = durText(m); updateEndPreview(); };
    const setStartVal = (m) => { b.plannedStart = L.hmStr(m); el.querySelector('[data-start]').textContent = b.plannedStart; updateEndPreview(); };
    window.Roll.durRoll(el.querySelector('[data-dur]'), { get: () => b.expectedMin, onChange: setDurVal, set: setDurVal });
    window.Roll.timeRoll(el.querySelector('[data-start]'), { get: () => L.hm(b.plannedStart || el.querySelector('[data-start]').textContent), onChange: setStartVal, set: setStartVal });
    const hours = Array.from({ length: 13 }, (_, i) => i), mins = Array.from({ length: 12 }, (_, i) => i * 5);
    const makers = {};
    makers.dur = () => pickers.push(app.picker.create({
      containerEl: el.querySelector('#pick-dur'), toolbar: false, rotateEffect: true,
      value: [Math.min(12, Math.floor(b.expectedMin / 60)), b.expectedMin % 60 - (b.expectedMin % 5)],
      cols: [{ values: hours, displayValues: hours.map((h) => `${h} h`) }, { values: mins, displayValues: mins.map((m) => `${m} min`) }],
      on: { change(_p, v) { const m = Math.max(5, +v[0] * 60 + +v[1]); setDurVal(m); Sound.tap(); } },
    }));
    const ps = b.plannedStart || '09:00';
    const hh = Array.from({ length: 24 }, (_, i) => i);
    makers.start = () => pickers.push(app.picker.create({
      containerEl: el.querySelector('#pick-start'), toolbar: false, rotateEffect: true,
      value: [+ps.slice(0, 2), Math.round(+ps.slice(3) / 5) * 5 % 60],
      cols: [{ values: hh, displayValues: hh.map(L.pad) }, { divider: true, content: ':' }, { values: mins, displayValues: mins.map(L.pad) }],
      on: { change(_p, v) { b.plannedStart = `${L.pad(+v[0])}:${L.pad(+v[1])}`; el.querySelector('[data-start]').textContent = b.plannedStart; updateEndPreview(); Sound.tap(); } },
    }));
    el.querySelectorAll('[data-toggle]').forEach((a) => a.addEventListener('click', () => {
      const k = a.dataset.toggle, w = el.querySelector(`[data-wheel="${k}"]`); w.hidden = !w.hidden;
      if (!w.hidden && makers[k]) { makers[k](); makers[k] = null; }
    }));
    el.querySelector('[name=timed]').addEventListener('change', (e) => {
      el.querySelector('[data-row="start"]').hidden = !e.target.checked;
      if (!e.target.checked) el.querySelector('[data-wheel="start"]').hidden = true;
      if (e.target.checked && !b.plannedStart) b.plannedStart = el.querySelector('[data-start]').textContent;
      updateEndPreview();
    });
    el.querySelector('[data-save]').addEventListener('click', () => {
      const f = (n) => el.querySelector(`[name=${n}]`);
      const cat = Cats.byId(b.cat) || Cats.list()[0];
      b.kind = Cats.kindOf(cat);
      b.title = f('title').value.trim() || (b.kind === 'task' ? 'Untitled task' : cat.name);
      b.date = f('date').value || key;
      b.fixed = f('fixed').checked;
      if (!f('timed').checked) b.plannedStart = null;
      if (block && block.plannedStart !== b.plannedStart) b.origStart = block.origStart || block.plannedStart;
      saved = true;
      if (S.settings.lastCat !== b.cat) Store.setKV('settings', { ...S.settings, lastCat: b.cat });
      if (block && b.plannedStart && b.date === block.date && (b.plannedStart !== block.plannedStart || b.expectedMin !== block.expectedMin)) {
        Store.saveBlock({ ...b, plannedStart: block.plannedStart, expectedMin: block.expectedMin });
        applyTime(S.blocks.find((x) => x.id === b.id), L.hm(b.plannedStart), b.expectedMin);
      } else Store.saveBlock(b);
      popup.close();
    });
    const del = el.querySelector('[data-del]');
    if (del) del.addEventListener('click', () => { Store.deleteBlock(b.id); popup.close(); });
    popup.open();
    return popup;
  }

  // ---------- Settings ----------
  let routineTab = 'morning';
  const THEMES = [['green', '#30d158'], ['orange', '#ff9f0a'], ['blue', '#0a84ff'], ['purple', '#bf5af2'], ['pink', '#ff375f'], ['mono', '#f2f2f7']];
  function applyTheme() {
    const t = S.settings.theme || 'green';
    if (t === 'green') delete document.documentElement.dataset.accent; else document.documentElement.dataset.accent = t;
    const c = (THEMES.find((x) => x[0] === t) || THEMES[0])[1];
    document.querySelector('meta[name=theme-color]').setAttribute('content', '#000000');
    document.documentElement.style.setProperty('--f7-theme-color', c);
  }
  function settingsPopup() {
    const app = window.app;
    const popup = app.popup.create({
      swipeToClose: true, push: true,
      content: `<div class="popup"><div class="view"><div class="page">
        <div class="navbar"><div class="navbar-bg"></div><div class="navbar-inner"><div class="left"></div><div class="title">Settings</div>
          <div class="right"><a class="link popup-close" style="font-weight:600">Done</a></div></div></div>
        <div class="page-content" id="settings-body"></div></div></div></div>`,
      on: { closed(p) { setTimeout(() => p.destroy()); } },
    });
    const body = popup.el.querySelector('#settings-body');
    const pickers = [];
    function render() {
      pickers.splice(0).forEach((p) => p.destroy());
      const items = S.routines[routineTab];
      const stepper = (name, val, label) => `<li><div class="item-content"><div class="item-inner"><div class="item-title">${label}</div><div class="item-after">
        <span class="num" style="margin-right:12px;color:var(--label)">${L.fmtDur(val)}</span>
        <div class="stepper stepper-small"><div class="stepper-button-minus" data-step="${name}" data-d="-15"></div><div class="stepper-button-plus" data-step="${name}" data-d="15"></div></div></div></div></div></li>`;
      const theme = S.settings.theme || 'green';
      body.innerHTML = `
        <div class="block-title">Theme</div>
        <div class="list list-strong inset"><div class="themes">${THEMES.map(([k, c]) => `<button class="theme-dot ${k === theme ? 'on' : ''}" data-theme-pick="${k}" style="--c:${c}" aria-label="${k} theme"></button>`).join('')}</div></div>
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
              <div class="item-after"><span class="r-time num ${it.min ? '' : 'none'}" data-rtime="${i}">${it.min ? L.fmtDur(it.min) : 'Add time'}</span></div></div></div>
              <div class="r-wheel" data-rw="${i}" hidden><div></div></div></div>
              <div class="sortable-handler"></div>
              <div class="swipeout-actions-right"><a class="swipeout-delete" data-confirm="false">Delete</a></div></li>`).join('')}
        </ul></div>
        <div class="list list-strong list-dividers inset" style="margin-top:-20px"><ul><li><a class="item-content item-link no-chevron" data-radd><div class="item-media"><i class="f7-icons green" style="font-size:22px">plus_circle_fill</i></div><div class="item-inner"><div class="item-title green">Add Item</div></div></a></li></ul></div>
        <div class="block-footer" style="margin:-24px 32px 24px">Drag to reorder. Swipe left to delete. Tap the time to set how long it takes.</div>
        <div class="block-title">Categories</div>
        <div class="list list-strong list-dividers inset cats"><ul>
          ${window.Cats.list().map((c) => `<li><div class="item-content">
            <div class="item-media"><a class="cat-dot big" data-catcolor="${c.id}" style="--c:${window.Cats.hex(c)}" aria-label="Colour"></a></div>
            <div class="item-inner"><a class="item-title" data-catname="${c.id}">${esc(c.name)}</a>
              <div class="item-after">${c.kind ? '<span class="cat-note">Not work</span>' : `<span class="cat-note">Counts as work</span><label class="toggle"><input type="checkbox" data-catwork="${c.id}" ${c.work !== false ? 'checked' : ''}><span class="toggle-icon"></span></label>`}</div></div></div></li>`).join('')}
          <li><a class="item-content item-link no-chevron" data-catadd><div class="item-media"><i class="f7-icons green" style="font-size:22px">plus_circle_fill</i></div><div class="item-inner"><div class="item-title green">New Category</div></div></a></li>
        </ul></div>
        <div class="block-footer" style="margin:-24px 32px 24px">Tap a dot to change its colour, a name to rename or delete it. "Work" means its time counts towards your daily work goal.</div>
        <div class="block-title">Notifications</div>
        <div class="list list-strong list-dividers inset"><ul><li><a class="item-content item-link no-chevron" data-push><div class="item-inner"><div class="item-title">Notifications</div><div class="item-after" id="push-state">${window.Push ? window.Push.label() : ''}</div></div></a></li></ul></div>
        <div class="block-title">Help</div>
        <div class="list list-strong list-dividers inset"><ul><li><a class="item-content item-link" data-support><div class="item-inner"><div class="item-title">Report a Bug or Idea</div><div class="item-after">${window.Support ? window.Support.count() : ''}</div></div></a></li></ul></div>
        <div style="height:30px"></div>`;
      body.querySelectorAll('[data-theme-pick]').forEach((d) => d.addEventListener('click', () => {
        Store.setKV('settings', { ...S.settings, theme: d.dataset.themePick });
        applyTheme(); window.FX.Sound.tap(); render();
      }));
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
              t.textContent = m ? L.fmtDur(m) : 'Add time'; t.classList.toggle('none', !m);
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
      // categories
      const Cats = window.Cats;
      const setCats = (f) => { Cats.save(Cats.list().map((c) => f(c) || c)); render(); };
      body.querySelectorAll('[data-catcolor]').forEach((d) => d.addEventListener('click', () => {
        const id = d.dataset.catcolor;
        app.actions.create({ cssClass: 'more-menu', buttons: [Cats.COLORS.map(([name, hex]) => ({
          text: `<span class="cat-dot" style="--c:${hex}"></span>${name[0].toUpperCase() + name.slice(1)}`,
          onClick: () => setCats((c) => (c.id === id ? { ...c, color: name } : null)),
        })), [{ text: 'Cancel', bold: true }]] }).open();
      }));
      body.querySelectorAll('[data-catname]').forEach((a) => a.addEventListener('click', () => {
        const c = Cats.byId(a.dataset.catname); if (!c) return;
        const buttons = [{ text: esc(c.name), label: true }, { text: 'Rename', onClick: () => app.dialog.prompt('', 'Rename category', (v) => { if (v && v.trim()) setCats((x) => (x.id === c.id ? { ...x, name: v.trim() } : null)); }, null, c.name) }];
        if (!c.kind && Cats.list().filter((x) => !x.kind).length > 1) {
          buttons.push({ text: 'Delete', color: 'red', onClick: () => { Cats.save(Cats.list().filter((x) => x.id !== c.id)); render(); } });
        }
        app.actions.create({ buttons: [buttons, [{ text: 'Cancel', bold: true }]] }).open();
      }));
      body.querySelectorAll('[data-catwork]').forEach((t) => t.addEventListener('change', () => setCats((c) => (c.id === t.dataset.catwork ? { ...c, work: t.checked } : null))));
      body.querySelector('[data-catadd]').addEventListener('click', () => Cats.create(() => render()));
      body.querySelector('[data-support]').addEventListener('click', () => window.Support && window.Support.open());
      body.querySelector('[data-push]').addEventListener('click', async () => { if (window.Push) { await window.Push.enable(); render(); } });
    }
    render();
    popup.open();
  }

  window.UI = {
    $, esc, longDate, shortDate, timeOf, stepFor, stepTitle, dayBlocks, running, DAYS, MONTHS,
    start, pause, done, startGym, blockMenu, stepMenu, taskEditor, settingsPopup, applyTheme,
    complete, remove, undoToast, applyTime, extendSheet, sleepWakeSheet, idleExplainSheet, idleSnoozeSheet,
  };
})();
