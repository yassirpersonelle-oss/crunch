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
    window.UI.celebrate(L.onTime(nb), diffMin, L.combo(S.blocks, nb.date), nb);
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

  function stepMenu(nStep) {
    const s = S.steps.find((x) => x.n === nStep); if (!s) return;
    window.app.actions.create({ buttons: [[{ text: `Step ${s.n} · ${esc(s.title)}`, label: true },
      { text: s.done ? 'Mark Not Done' : 'Mark Done', bold: true, onClick: () => Store.setKV('steps', S.steps.map((x) => (x.n === nStep ? { ...x, done: !x.done } : x))) }],
      [{ text: 'Cancel', bold: true }]] }).open();
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
            <li><a class="item-content item-link no-chevron" data-toggle="dur"><div class="item-inner"><div class="item-title">Duration</div><div class="item-after green num" data-dur>${durText(b.expectedMin)}</div></div></a></li>
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
  const THEMES = [['green', '#30d158'], ['orange', '#ff9f0a'], ['blue', '#0a84ff'], ['purple', '#bf5af2'], ['pink', '#ff375f'], ['mono', '#f2f2f7']];
  // The accent colour of the whole app comes from one attribute on <html>.
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
        <div class="block-title">Notifications</div>
        <div class="list list-strong list-dividers inset"><ul><li><a class="item-content item-link no-chevron" data-push><div class="item-inner"><div class="item-title">Notifications</div><div class="item-after" id="push-state">${window.Push ? window.Push.label() : ''}</div></div></a></li></ul></div>
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
      body.querySelector('[data-push]').addEventListener('click', async () => { if (window.Push) { await window.Push.enable(); render(); } });
    }
    render();
    popup.open();
  }

  window.UI = {
    $, esc, longDate, shortDate, timeOf, stepFor, stepTitle, dayBlocks, running, DAYS, MONTHS,
    start, pause, done, startGym, blockMenu, stepMenu, taskEditor, settingsPopup, applyTheme,
  };
})();
