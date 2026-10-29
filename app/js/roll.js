// Crunch - "hold and roll": press a time, a duration or a category and slide up or down to change it inline.
// No floating popup window: numbers and colours update right in place with haptic + audio feedback on every step.
(function () {
  const L = window.Logic, Store = window.Store, S = Store.state;
  const PX = 13;            // finger travel per step
  const FAST = 0.9;         // px/ms: above this speed one step of travel moves 3 values

  function stepFeedback(el) {
    if (window.FX) {
      window.FX.Sound.tap();
      if (window.FX.haptic) window.FX.haptic(8);
    }
    el.classList.remove('roll-tick');
    void el.offsetWidth;
    el.classList.add('roll-tick');
  }

  // opts: { values: [...], index(): current index, label(v): text, onChange(v), onEnd(v), onTap() }
  function attach(el, opts) {
    el.classList.add('roll');
    let st = null;
    // a sideways slide belongs to the row's swipe (done / delete); only an active vertical roll keeps the touch to itself
    el.addEventListener('touchmove', (e) => { if (st && st.active) e.stopPropagation(); }, { passive: true });
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const vals = typeof opts.values === 'function' ? opts.values() : opts.values;
      st = { x: e.clientX, y: e.clientY, last: e.clientY, t: performance.now(), i: Math.max(0, opts.index(vals)), vals, moved: false, pid: e.pointerId, active: false, acc: 0 };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      st.hold = setTimeout(() => { if (st && !st.moved) activate(); }, 200);
    });
    function activate() {
      if (!st || st.active) return;
      st.moved = true;
      st.active = true;
      el.classList.add('rolling');
      draw();
      stepFeedback(el);
    }
    function draw() {
      const v = st.vals[st.i];
      el.textContent = opts.label(v);
      if (opts.onChange) opts.onChange(v);
    }
    el.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dy = st.last - e.clientY; // finger up = later / longer
      if (!st.active) {
        const ax = Math.abs(e.clientX - st.x), ay = Math.abs(e.clientY - st.y);
        if (ax > 6 && ax > ay) { clearTimeout(st.hold); try { el.releasePointerCapture(st.pid); } catch (err) { /* ignore */ } st = null; return; }
        if (ay < 4) return;
        activate();
      }
      const now = performance.now(), speed = Math.abs(e.clientY - st.last) / Math.max(1, now - st.t);
      st.t = now; st.last = e.clientY;
      st.acc += dy * (speed > FAST ? 3 : 1);
      const steps = Math.trunc(st.acc / PX);
      if (!steps) return;
      st.acc -= steps * PX;
      const ni = Math.max(0, Math.min(st.vals.length - 1, st.i + steps));
      if (ni !== st.i) {
        st.i = ni;
        draw();
        stepFeedback(el);
      }
    });
    const end = (e) => {
      if (!st) return;
      clearTimeout(st.hold);
      const s = st; st = null;
      el.classList.remove('rolling', 'roll-tick');
      if (s.active) {
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
  function timeRoll(el, { get, set, onChange, exact }) {
    attach(el, {
      values: () => { const v = times(); const g = get(); if (exact && g % 5) { v.push(g); v.sort((a, b) => a - b); } return v; },
      index: (vals) => nearest(vals, get()),
      label: (m) => L.hmStr(m),
      onChange: onChange || null,
      onEnd: set,
    });
  }
  function durRoll(el, { get, set, onChange }) {
    attach(el, {
      values: durs,
      index: (vals) => nearest(vals, get()),
      label: (m) => L.fmtDur(m),
      onChange: onChange || null,
      onEnd: set,
    });
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
  // a category roll: slide through the categories; colour updates live on every step!
  function catRoll(el, { get, set }) {
    attach(el, {
      values: () => [...Cats.list().map((c) => c.id), '+new'],
      index: (vals) => Math.max(0, vals.indexOf(get())),
      label: (id) => (id === '+new' ? 'New category…' : (Cats.byId(id) || {}).name || ''),
      onChange: (id) => {
        if (id === '+new') {
          el.style.setProperty('--c', '#8e8e93');
        } else {
          set(id);
        }
      },
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
