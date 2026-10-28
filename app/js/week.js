// Crunch - Week tab: iOS-Calendar-style week strip + a day timeline with drag-to-move, drag-to-resize and ripple.
(function () {
  const L = window.Logic, Store = window.Store, S = Store.state, UI = window.UI;
  const PX = 1.15;          // pixels per minute
  const SNAP = 5;
  const HOLD_MS = 320;
  let sel = null;           // selected date key
  let drag = null;

  const DL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function weekStart(key) { const d = L.parseDate(key); const dow = (d.getDay() + 6) % 7; return L.addDays(key, -dow); } // Monday

  function renderStrip() {
    const today = Store.today(); sel = sel || today;
    const ws = weekStart(sel);
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const k = L.addDays(ws, i), d = L.parseDate(k);
      const has = S.blocks.some((b) => b.date === k);
      cells.push(`<div class="wd ${k === today ? 'today' : ''} ${k === sel ? 'sel' : ''}" data-day="${k}">
        <span class="wd-l">${DL[d.getDay()]}</span><span class="wd-n">${d.getDate()}</span><span class="wd-dot ${has ? '' : 'off'}"></span></div>`);
    }
    document.getElementById('week-strip').innerHTML = `<div class="week-strip">${cells.join('')}</div>`;
    document.getElementById('week-title').textContent = MONTHS[L.parseDate(sel).getMonth()];
  }

  function range() {
    const timed = S.blocks.filter((b) => b.date === sel && b.plannedStart);
    const first = Math.min(L.hm(S.settings.wake), ...timed.map((b) => L.hm(b.plannedStart)));
    return { from: Math.floor(first / 60) * 60, to: 24 * 60 };
  }

  function render() {
    renderStrip();
    const today = Store.today(), n = Store.now();
    const { from, to } = range();
    const y = (min) => (min - from) * PX;
    const blocks = UI.dayBlocks(sel);
    const timed = blocks.filter((b) => b.plannedStart);
    const anytime = blocks.filter((b) => !b.plannedStart);
    const step = UI.stepFor(sel);
    const bed = L.hm(S.settings.bed);
    let html = `<div class="day-head"><span>${UI.longDate(sel)}</span><span>${step ? `Step ${step.n} · ${UI.esc(step.title)}` : ''}</span></div>`;
    if (anytime.length) {
      html += `<div class="list list-strong list-dividers inset tasks anytime"><ul>${anytime.map((b) => UI.rowHTML(b, n, { noTime: true })).join('')}</ul></div>`;
    }
    html += `<div class="tl" id="tl" style="height:${(to - from) * PX + 20}px">`;
    for (let m = from; m <= to; m += 60) html += `<div class="tl-hour" style="top:${y(m)}px"><span>${m === 1440 ? '00:00' : L.hmStr(m)}</span></div>`;
    html += `<div class="tl-bed" style="top:${y(bed)}px"><span>Bedtime</span></div>`;
    if (sel === today) html += `<div class="tl-now" style="top:${y(L.minOfDay(n))}px"></div>`;
    for (const b of timed) {
      const s = L.hm(b.plannedStart), h = Math.max(22, b.expectedMin * PX - 4);
      const late = !b.doneAt && s + b.expectedMin > bed;
      const cls = [b.kind !== 'task' ? b.kind : '', b.doneAt ? 'done' : '', late ? 'late' : '', h < 40 ? 'short' : '', 'cat'].join(' ');
      html += `<div class="blk ${cls}" data-id="${b.id}" style="top:${y(s) + 2}px;height:${h}px;--c:${window.Cats.hex(window.Cats.of(b))}">
        <b>${b.doneAt ? '✓ ' : ''}${UI.esc(b.title)}</b><span class="t num">${b.plannedStart} – ${L.hmStr(s + b.expectedMin)}${b.fixed ? ' · fixed' : ''}</span>
        ${b.doneAt ? '' : '<div class="grip"></div>'}</div>`;
    }
    html += '</div>';
    document.getElementById('week').innerHTML = html;
    const any = document.querySelector('#week .anytime ul'); if (any) UI.armRows(any);
  }

  function scrollToNow() {
    const sc = document.getElementById('week-scroll'), { from } = range();
    const target = sel === Store.today() ? L.minOfDay(Store.now()) - 90 : L.hm(S.settings.wake);
    const tl = document.getElementById('tl');
    if (sc && tl) sc.scrollTop = Math.max(0, tl.offsetTop + (target - from) * PX - parseFloat(getComputedStyle(sc).paddingTop) - 12);
  }

  // ---------- pointer handling ----------
  function minutesAt(clientY) {
    const tl = document.getElementById('tl'), r = tl.getBoundingClientRect();
    return range().from + (clientY - r.top) / PX;
  }
  const snap = (m) => Math.round(m / SNAP) * SNAP;

  function onDown(e) {
    const blk = e.target.closest('.blk');
    const tl = e.target.closest('#tl');
    if (!tl) return;
    if (!blk) { // tap on empty space -> new task at that time
      const startY = e.clientY, t0 = Date.now();
      const up = (ev) => {
        tl.removeEventListener('pointerup', up);
        if (Math.abs(ev.clientY - startY) < 6 && Date.now() - t0 < 500) {
          const m = Math.min(23 * 60 + 55, Math.floor(minutesAt(ev.clientY) / 15) * 15);
          UI.taskEditor({ date: sel, start: L.hmStr(m) });
        }
      };
      tl.addEventListener('pointerup', up);
      return;
    }
    const b = S.blocks.find((x) => x.id === blk.dataset.id); if (!b) return;
    const resize = !!e.target.closest('.grip');
    drag = {
      b, el: blk, mode: resize ? 'resize' : 'pending', y0: e.clientY, x0: e.clientX, t0: Date.now(),
      start: L.hm(b.plannedStart), len: b.expectedMin, pid: e.pointerId, label: null,
    };
    if (resize) beginDrag(); else drag.hold = setTimeout(() => { if (drag && drag.mode === 'pending' && !b.doneAt) { drag.mode = 'move'; beginDrag(); } }, HOLD_MS);
  }
  function beginDrag() {
    drag.el.classList.add('drag');
    try { drag.el.setPointerCapture(drag.pid); } catch (err) { /* ignore */ }
    drag.label = document.createElement('div'); drag.label.className = 'drag-label';
    document.getElementById('tl').appendChild(drag.label);
    if (navigator.vibrate) navigator.vibrate(8);
    window.FX.Sound.pop();
    updateDrag(drag.y0);
  }
  function updateDrag(clientY) {
    const dy = (clientY - drag.y0) / PX, { from } = range();
    if (drag.mode === 'resize') {
      drag.newLen = Math.max(SNAP, snap(drag.len + dy));
      drag.newStart = drag.start;
      drag.el.style.height = `${Math.max(22, drag.newLen * PX - 4)}px`;
      drag.label.textContent = `${L.fmtDur(drag.newLen)} · ends ${L.hmStr(drag.start + drag.newLen)}`;
      drag.label.style.top = `${(drag.start + drag.newLen - from) * PX - 8}px`;
    } else {
      drag.newStart = Math.max(0, Math.min(24 * 60 - drag.len, snap(drag.start + dy)));
      drag.newLen = drag.len;
      drag.el.style.top = `${(drag.newStart - from) * PX + 2}px`;
      drag.label.textContent = L.hmStr(drag.newStart);
      drag.label.style.top = `${(drag.newStart - from) * PX - 8}px`;
    }
  }
  function onMove(e) {
    if (!drag) return;
    if (drag.mode === 'pending') {
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      // sideways: swipe right = done, left = delete
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) { clearTimeout(drag.hold); drag.mode = 'swipe'; drag.el.classList.add('swiping'); return; }
      if (Math.abs(dy) > 8) { clearTimeout(drag.hold); drag = null; } // it was a scroll
      return;
    }
    if (drag.mode === 'swipe') {
      e.preventDefault();
      const dx = e.clientX - drag.x0;
      drag.dx = dx;
      drag.el.style.transform = `translateX(${dx}px)`;
      drag.el.classList.toggle('sw-done', dx > 70 && !drag.b.doneAt);
      drag.el.classList.toggle('sw-del', dx < -70);
      return;
    }
    e.preventDefault();
    updateDrag(e.clientY);
  }
  function onUp() {
    if (!drag) return;
    clearTimeout(drag.hold);
    const d = drag; drag = null;
    if (d.mode === 'pending') { // a tap
      if (Date.now() - d.t0 < HOLD_MS + 50) UI.blockMenu(d.b);
      return;
    }
    if (d.mode === 'swipe') {
      if (d.dx > 70 && !d.b.doneAt) UI.complete(d.b.id);
      else if (d.dx < -70) UI.remove(d.b.id);
      render();
      return;
    }
    if (d.label) d.label.remove();
    if (d.newStart === d.start && d.newLen === d.len) { render(); return; }
    const out = L.ripple(S.blocks, sel, d.b.id, d.newStart, d.newLen);
    const changed = [];
    for (const b of S.blocks) {
      if (b.date !== sel || !(b.id in out)) continue;
      const ns = L.hmStr(out[b.id]);
      const nl = b.id === d.b.id ? d.newLen : b.expectedMin;
      if (ns !== b.plannedStart || nl !== b.expectedMin) changed.push({ ...b, plannedStart: ns, expectedMin: nl });
    }
    Store.saveBlocks(changed);
    window.FX.Sound.tick();
  }
  // iOS: stop the page from scrolling while a block is being dragged.
  function onTouchMove(e) { if (drag && drag.mode !== 'pending') e.preventDefault(); }

  function init() {
    const root = document.getElementById('week');
    root.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    document.getElementById('week-strip').addEventListener('click', (e) => {
      const d = e.target.closest('[data-day]'); if (!d) return;
      sel = d.dataset.day; render(); scrollToNow();
    });
    // swipe the strip left/right to change week
    let sx = null;
    const strip = document.getElementById('week-strip');
    strip.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    strip.addEventListener('touchend', (e) => {
      if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 50) { sel = L.addDays(sel, dx < 0 ? 7 : -7); render(); }
    });
  }

  window.Week = {
    init, render, scrollToNow,
    selected: () => sel || Store.today(),
    goToday() { sel = Store.today(); render(); scrollToNow(); },
    isDragging: () => !!drag && drag.mode !== 'pending',
  };
})();
