// Crunch - "hold and roll": press a time, a duration or a category and slide up or down to change it.
// A small wheel shows the values around the finger, with a click on every step (iPhone won't let a web
// app vibrate during a slide). Also: categories (colours, "counts as work").
(function () {
  const L = window.Logic, Store = window.Store, S = Store.state;
  const PX = 13;            // finger travel per step
  const FAST = 0.9;         // px/ms: above this speed one step of travel moves 3 values

  // opts: { values: [...], index(): current index, label(v): text, onEnd(v), onTap() }
  // Numeric helpers below build `values` for times and durations.
  function attach(el, opts) {
    el.classList.add('roll');
    let st = null;
    const stop = (e) => e.stopPropagation();
    el.addEventListener('touchstart', stop, { passive: true }); // keep F7 swipeout off this spot
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const vals = typeof opts.values === 'function' ? opts.values() : opts.values;
      st = { y: e.clientY, last: e.clientY, t: performance.now(), i: Math.max(0, opts.index(vals)), vals, moved: false, pid: e.pointerId, pop: null, acc: 0 };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      st.hold = setTimeout(() => { if (st && !st.moved) open(); }, 220);
    });
    function open() {
      if (st.pop) return;
      st.moved = true;
      st.pop = document.createElement('div'); st.pop.className = 'roll-pop';
      document.body.appendChild(st.pop);
      el.classList.add('rolling');
      draw();
      window.FX.Sound.tap();
    }
    function draw() {
      const r = el.getBoundingClientRect(), rows = [];
      for (let k = -2; k <= 2; k++) {
        const v = st.vals[st.i + k];
        rows.push(`<div class="${k === 0 ? 'on' : ''} d${Math.abs(k)}">${v === undefined ? '' : opts.label(v)}</div>`);
      }
      st.pop.innerHTML = rows.join('');
      const w = Math.max(120, r.width + 40);
      st.pop.style.width = `${w}px`;
      st.pop.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
      st.pop.style.top = `${r.top + r.height / 2 - 110}px`;
      el.textContent = opts.label(st.vals[st.i]);
    }
    el.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dy = st.last - e.clientY; // finger up = later / longer
      if (!st.pop) { if (Math.abs(e.clientY - st.y) < 4) return; open(); }
      const now = performance.now(), speed = Math.abs(e.clientY - st.last) / Math.max(1, now - st.t);
      st.t = now; st.last = e.clientY;
      st.acc += dy * (speed > FAST ? 3 : 1);
      let steps = Math.trunc(st.acc / PX);
      if (!steps) return;
      st.acc -= steps * PX;
      const ni = Math.max(0, Math.min(st.vals.length - 1, st.i + steps));
      if (ni !== st.i) { st.i = ni; draw(); window.FX.Sound.tap(); }
    });
    const end = (e) => {
      if (!st) return;
      clearTimeout(st.hold);
      const s = st; st = null;
      el.classList.remove('rolling');
      if (s.pop) {
        s.pop.remove();
        // swallow the click that follows, so the row behind doesn't open its menu
        const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener('click', eat, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', eat, { capture: true }), 400);
        opts.onEnd(s.vals[s.i]);
      } else if (e.type === 'pointerup' && opts.onTap) {
        e.preventDefault(); opts.onTap();
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // value lists
  const times = (stepMin = 5) => Array.from({ length: 1440 / stepMin }, (_, i) => i * stepMin);
  const durs = () => [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 420, 480];
  const nearest = (vals, v) => vals.reduce((bi, x, i) => (Math.abs(x - v) < Math.abs(vals[bi] - v) ? i : bi), 0);
  // time of day in minutes; `exact` keeps an odd minute (like 14:07) in the list so the wheel starts on it
  function timeRoll(el, { get, set, exact }) {
    attach(el, {
      values: () => { const v = times(); const g = get(); if (exact && g % 5) { v.push(g); v.sort((a, b) => a - b); } return v; },
      index: (vals) => nearest(vals, get()),
      label: (m) => L.hmStr(m),
      onEnd: set,
    });
  }
  function durRoll(el, { get, set }) {
    attach(el, { values: durs, index: (vals) => nearest(vals, get()), label: (m) => L.fmtDur(m), onEnd: set });
  }

  // ---------- categories ----------
  const COLORS = [['orange', '#ff9f0a'], ['green', '#30d158'], ['teal', '#64d2ff'], ['blue', '#0a84ff'],
    ['purple', '#bf5af2'], ['pink', '#ff375f'], ['red', '#ff453a'], ['yellow', '#ffd60a']];
  const DEFAULT_CATS = [
    { id: 'work', name: 'Work', color: 'orange', work: true },
    { id: 'gym', name: 'Gym', color: 'green', work: false, kind: 'gym' },
    { id: 'routine', name: 'Routine', color: 'teal', work: false, kind: 'routine' },
  ];
  const Cats = {
    COLORS,
    list: () => (S.settings.categories && S.settings.categories.length ? S.settings.categories : DEFAULT_CATS),
    save(list) { Store.setKV('settings', { ...S.settings, categories: list }); },
    byId: (id) => Cats.list().find((c) => c.id === id),
    // old blocks have only a kind; new ones carry a category id
    of: (b) => Cats.byId(b.cat) || Cats.byId(b.kind === 'gym' ? 'gym' : b.kind === 'routine' ? 'routine' : 'work') || Cats.list()[0],
    hex: (c) => (COLORS.find((x) => x[0] === (c && c.color)) || COLORS[0])[1],
    kindOf: (c) => (c && c.kind) || 'task',
    last: () => Cats.byId(S.settings.lastCat) || Cats.list()[0],
    // ask for a name, add it with the next unused colour; calls back with the new category
    create(done) {
      window.app.dialog.prompt('Name of the new category', 'New category', (name) => {
        name = (name || '').trim(); if (!name) return;
        const used = Cats.list().map((c) => c.color);
        const color = (COLORS.find((x) => !used.includes(x[0])) || COLORS[Cats.list().length % COLORS.length])[0];
        const c = { id: Store.uid(), name, color, work: true };
        Cats.save([...Cats.list(), c]);
        if (done) done(c);
      });
    },
  };
  // a category roll: slide through the categories; the last stop is "New category…"
  function catRoll(el, { get, set }) {
    attach(el, {
      values: () => [...Cats.list().map((c) => c.id), '+new'],
      index: (vals) => Math.max(0, vals.indexOf(get())),
      label: (id) => (id === '+new' ? 'New category…' : (Cats.byId(id) || {}).name || ''),
      onEnd: (id) => (id === '+new' ? Cats.create((c) => set(c.id)) : set(id)),
      onTap: () => catSheet(get(), set),
    });
  }
  // tap: the same choice as an up-and-down list
  function catSheet(cur, set) {
    const dot = (c) => `<span class="cat-dot" style="--c:${Cats.hex(c)}"></span>`;
    window.app.actions.create({ cssClass: 'more-menu', buttons: [[
      ...Cats.list().map((c) => ({ text: `${dot(c)}${window.UI.esc(c.name)}${c.id === cur ? ' ✓' : ''}`, onClick: () => set(c.id) })),
      { text: '<span class="cat-dot new"></span>New category…', onClick: () => Cats.create((c) => set(c.id)) },
    ], [{ text: 'Cancel', bold: true }]] }).open();
  }

  window.Roll = { attach, timeRoll, durRoll, catRoll, catSheet, times, durs };
  window.Cats = Cats;
})();
