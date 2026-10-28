// Crunch - Focus mode: the running task's countdown, huge, with the screen kept awake. Scroll down for
// subtasks (name, start, length -> end worked out; tick it off to stamp the real finish) and notes.
// Opens by itself after 20 s untouched on Today while a task runs (app.js), or from the Focus button.
(function () {
  const L = window.Logic, Store = window.Store, S = Store.state, { Sound } = window.FX;
  const UI = () => window.UI;
  const esc = (s) => window.UI.esc(s);
  let isOpen = false, lock = null, saveTimer = null;
  const add = { title: '', start: null, dur: 15 };
  const root = () => document.getElementById('focus');
  const $ = (sel) => root().querySelector(sel);
  const nowMin = () => L.minOfDay(Store.now());

  // ---- screen stays awake while Focus is open ----
  async function wake() { try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) { lock = null; } }
  document.addEventListener('visibilitychange', () => { if (isOpen && !document.hidden) wake(); });

  function open() {
    if (!UI().running() || isOpen) return;
    isOpen = true;
    const el = root(); el.hidden = false; el.scrollTop = 0;
    render(true);
    requestAnimationFrame(() => el.classList.add('in'));
    wake();
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    const el = root(); el.classList.remove('in');
    setTimeout(() => { if (!isOpen) el.hidden = true; }, 250);
    if (lock) { lock.release().catch(() => {}); lock = null; }
    window.dispatchEvent(new Event('focus-closed'));
  }

  // ---- numbers ----
  function bigText(b, n) {
    const act = L.actualMs(b, n), exp = b.expectedMin * L.MIN;
    return act > exp ? { t: `+${L.fmtTimer(act - exp)}`, over: true } : { t: L.fmtTimer(exp - act), over: false };
  }
  function dayLeft(n) {
    const s = Math.max(0, Math.floor(L.hoursLeft(n, S.settings).todayLeftMs / 1000));
    return `${Math.floor(s / 3600)}h ${L.pad(Math.floor(s / 60) % 60)}m ${L.pad(s % 60)}s left today`;
  }
  // when the running task's planned time runs out, in minutes of the day
  const taskEnd = (b, n) => L.minOfDay(n) + Math.max(0, (b.expectedMin * L.MIN - L.actualMs(b, n)) / L.MIN);

  // ---- subtasks ----
  const subs = (b) => b.subs || [];
  function saveSubs(b, list) { Store.saveBlock({ ...b, subs: list }); }
  function warnFor(b, list, s, d, selfId) {
    const hit = list.find((x) => x.id !== selfId && !x.done && s < x.s + x.d && s + d > x.s);
    if (hit) return `Overlaps ${esc(hit.t)} ${L.hmStr(hit.s)}–${L.hmStr(hit.s + hit.d)}`;
    const end = Math.round(taskEnd(b, Store.now()));
    if (s + d > end) return `Goes past the task's end (${L.hmStr(end)})`;
    return '';
  }
  const nextStart = (b) => {
    const list = subs(b); if (!list.length) return nowMin();
    const last = list[list.length - 1];
    return Math.max(nowMin(), last.done != null ? last.done : last.s + last.d);
  };
  function subHTML(b, x, list) {
    const w = x.done == null ? warnFor(b, list, x.s, x.d, x.id) : '';
    const diff = x.done == null ? 0 : x.done - (x.s + x.d);
    return `<li class="fs ${x.done != null ? 'done' : ''}" data-sub="${x.id}">
      <a class="fs-chk" data-sub-chk="${x.id}" aria-label="Done">${x.done != null ? '<i class="f7-icons">checkmark_alt</i>' : ''}</a>
      <div class="fs-main"><div class="fs-t">${esc(x.t)}</div>
        <div class="fs-time num"><span class="fs-v" data-sub-s="${x.id}">${L.hmStr(x.s)}</span><span class="fs-arrow">→</span><span>${L.hmStr(x.s + x.d)}</span>
          <span class="fs-v fs-d" data-sub-d="${x.id}">${L.fmtDur(x.d)}</span></div>
        ${x.done != null ? `<div class="fs-done num">Done <span class="fs-v" data-sub-done="${x.id}">${L.hmStr(x.done)}</span>
          <b class="${diff > 0 ? 'red' : 'green'}">${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)} min</b></div>` : ''}
        ${w ? `<div class="fs-warn">${w}</div>` : ''}</div>
      <a class="fs-del" data-sub-del="${x.id}" aria-label="Delete"><i class="f7-icons">xmark</i></a></li>`;
  }

  function render(force) {
    if (!isOpen) return;
    const b = UI().running();
    if (!b) { close(); return; }
    const typing = document.activeElement && root().contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (typing && !force) { tick(); return; }
    const n = Store.now(), big = bigText(b, n), list = subs(b);
    const s = add.start == null ? nextStart(b) : add.start, warn = warnFor(b, list, s, add.dur, null);
    root().innerHTML = `<div class="fo-wrap">
      <a class="fo-top" data-fclose><i class="f7-icons">chevron_down</i>Today</a>
      <div class="fo-hero">
        <div class="fo-big num ${big.over ? 'over' : ''}" id="fo-big">${big.t}</div>
        <div class="fo-title">${esc(b.title)}</div>
        <div class="fo-day num" id="fo-day">${dayLeft(n)}</div>
        <div class="fo-acts"><button class="act primary" data-done="${b.id}"><span><i class="f7-icons">checkmark_alt</i></span>Done</button>
          <button class="act" data-pause="${b.id}"><span><i class="f7-icons">pause_fill</i></span>Pause</button></div>
        <div class="fo-hint"><i class="f7-icons">chevron_compact_down</i>Subtasks and notes</div>
      </div>
      <div class="fo-body">
        <h3>Subtasks</h3>
        ${list.length ? `<ul class="fo-subs">${list.map((x) => subHTML(b, x, list)).join('')}</ul>` : ''}
        <div class="qa open fo-add">
          <input id="fs-t" type="text" placeholder="Next step of this task" autocomplete="off" enterkeyhint="done" value="${esc(add.title)}">
          <div class="qa-row"><span class="qa-time"><span class="qa-s num" id="fs-s">${L.hmStr(s)}</span><span class="qa-arrow">→</span><span class="qa-e num" id="fs-e">${L.hmStr(s + add.dur)}</span></span>
            <span class="qa-d num" id="fs-d">${L.fmtDur(add.dur)}</span></div>
          <div class="qa-warn" id="fs-w">${warn}</div>
          <div class="qa-btns"><span></span><button class="btn fill qa-go" id="fs-go">Add</button></div>
        </div>
        <h3>Notes</h3>
        <textarea id="fo-notes" placeholder="Anything to remember for this task">${esc(b.notes || '')}</textarea>
      </div></div>`;
    arm(b);
  }

  function arm(b) {
    const R = window.Roll;
    const list = subs(b);
    const upd = (id, patch) => { const cur = UI().running(); if (!cur) return; saveSubs(cur, subs(cur).map((x) => (x.id === id ? { ...x, ...patch } : x))); render(true); };
    root().querySelectorAll('[data-sub-s]').forEach((el) => { const x = list.find((y) => y.id === el.dataset.subS); R.timeRoll(el, { exact: true, get: () => x.s, set: (m) => upd(x.id, { s: m }) }); });
    root().querySelectorAll('[data-sub-d]').forEach((el) => { const x = list.find((y) => y.id === el.dataset.subD); R.durRoll(el, { get: () => x.d, set: (m) => upd(x.id, { d: m }) }); });
    root().querySelectorAll('[data-sub-done]').forEach((el) => { const x = list.find((y) => y.id === el.dataset.subDone); R.timeRoll(el, { exact: true, get: () => x.done, set: (m) => upd(x.id, { done: m }) }); });
    root().querySelectorAll('[data-sub-chk]').forEach((el) => el.addEventListener('click', () => {
      const x = list.find((y) => y.id === el.dataset.subChk);
      upd(x.id, { done: x.done == null ? nowMin() : null });
      if (x.done == null) Sound.check(); else Sound.tap();
    }));
    root().querySelectorAll('[data-sub-del]').forEach((el) => el.addEventListener('click', () => {
      const cur = UI().running(); if (!cur) return;
      const before = subs(cur), x = before.find((y) => y.id === el.dataset.subDel);
      saveSubs(cur, before.filter((y) => y.id !== x.id)); render(true);
      UI().undoToast(`Deleted ${x.t}`, () => { const c2 = S.blocks.find((y) => y.id === cur.id); if (c2) { saveSubs(c2, before); render(true); } });
    }));
    // add a subtask
    const t = $('#fs-t');
    const startNow = () => (add.start == null ? nextStart(b) : add.start);
    const refresh = () => {
      const s = startNow();
      $('#fs-s').textContent = L.hmStr(s); $('#fs-e').textContent = L.hmStr(s + add.dur); $('#fs-d').textContent = L.fmtDur(add.dur);
      $('#fs-w').innerHTML = warnFor(b, subs(b), s, add.dur, null);
    };
    t.addEventListener('input', () => { add.title = t.value; });
    const go = () => {
      const title = add.title.trim(); if (!title) { t.focus(); return; }
      const cur = UI().running(); if (!cur) return;
      saveSubs(cur, [...subs(cur), { id: Store.uid(), t: title, s: startNow(), d: add.dur, done: null }]);
      Object.assign(add, { title: '', start: null });
      Sound.pop(); render(true);
      const t2 = $('#fs-t'); if (t2) t2.focus();
    };
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    $('#fs-go').addEventListener('click', go);
    R.timeRoll($('#fs-s'), { exact: true, get: startNow, set: (m) => { add.start = m; refresh(); } });
    R.durRoll($('#fs-d'), { get: () => add.dur, set: (m) => { add.dur = m; refresh(); } });
    // notes save a moment after you stop typing
    const notes = $('#fo-notes');
    notes.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { const cur = UI().running(); if (cur) Store.saveBlock({ ...cur, notes: notes.value }); }, 700);
    });
    $('[data-fclose]').addEventListener('click', close);
  }

  function tick() {
    if (!isOpen) return;
    const b = UI().running(); if (!b) { close(); return; }
    const n = Store.now(), big = bigText(b, n), el = $('#fo-big');
    if (!el) return;
    el.textContent = big.t; el.classList.toggle('over', big.over);
    $('#fo-day').textContent = dayLeft(n);
  }

  window.Focus = { open, close, render: () => render(false), tick, isOpen: () => isOpen };
})();
