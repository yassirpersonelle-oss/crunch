// Crunch - data layer. One state object; two backends: demo (localStorage) and Supabase (cloud + realtime).
(function () {
  const L = window.Logic;
  const params = new URLSearchParams(location.search);
  const DEMO = params.has('demo');
  const FIXED_NOW = params.get('at') ? new Date(params.get('at')) : null; // screenshot clock
  const T0 = Date.now();

  const DEFAULT_SETTINGS = {
    wake: '07:00', bed: '23:00', workGoalMin: 480, wasteAllowMin: 90,
    releaseAt: '2026-11-14T18:00', startDate: '2026-10-28',
  };
  const DEFAULT_STEPS = [
    { n: 1, title: 'Skins', start: '2026-10-27', end: '2026-10-27', note: 'Female skin + wardrobe mesh clothes left' },
    { n: 2, title: 'Animations', start: '2026-10-28', end: '2026-10-28' },
    { n: 3, title: 'Cars', start: '2026-10-29', end: '2026-10-29', note: 'Meshes, sounds' },
    { n: 4, title: 'Weapons', start: '2026-10-30', end: '2026-10-30' },
    { n: 5, title: 'Peds & Cops', start: '2026-10-31', end: '2026-10-31' },
    { n: 6, title: 'Missions', start: '2026-11-01', end: '2026-11-01', note: 'Missions + interactables' },
    { n: 7, title: 'Map & Lighting', start: '2026-11-02', end: '2026-11-06' },
    { n: 8, title: 'Mini-games', start: '2026-11-07', end: '2026-11-07' },
    { n: 9, title: 'Polish', start: '2026-11-08', end: '2026-11-08' },
    { n: 10, title: 'Multiplayer Sync', start: '2026-11-09', end: '2026-11-09', note: 'Cars + NPCs for both players' },
    { n: 11, title: 'Buffer', start: '2026-11-10', end: '2026-11-13', note: 'Phone tests, bug fixes' },
  ];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const DEFAULT_ROUTINES = {
    morning: ['Drink water', 'Toilet', 'Wash face', 'Brush teeth', 'Get dressed', 'Breakfast']
      .map((t, i) => ({ id: 'm' + i, title: t, min: [0, 0, 2, 2, 0, 15][i] || null })),
    night: ['Phone on charger', 'Set alarm 07:00', 'Toilet', 'Brush teeth', 'Wash face', 'Clothes ready for tomorrow']
      .map((t, i) => ({ id: 'n' + i, title: t, min: [0, 0, 0, 2, 2, 0][i] || null })),
  };

  const state = {
    settings: { ...DEFAULT_SETTINGS }, steps: DEFAULT_STEPS, routines: DEFAULT_ROUTINES,
    days: {}, blocks: [], user: null, demo: DEMO,
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => f(state));

  const now = () => (FIXED_NOW ? new Date(FIXED_NOW.getTime() + (Date.now() - T0)) : new Date());
  const today = () => L.dateKey(now());

  // ---------- demo backend ----------
  const DEMO_KEY = 'crunch-demo-v1';
  function demoSeed() {
    const n = now(), d0 = L.dateKey(n);
    const iso = (key, h, m) => L.at(key, h * 60 + m).toISOString();
    const days = {};
    const blocks = [];
    const grades = ['B', 'C', 'A', 'B', 'D', 'B', 'A'];
    for (let i = 7; i >= 1; i--) {
      const k = L.addDays(d0, -i), g = grades[7 - i];
      days[k] = {
        upAt: iso(k, 7, [5, 40, 0, 10, 95, 20, 0][7 - i]), bedAt: iso(k, 23, [10, 40, 0, 5, 50, 15, 0][7 - i]),
        finishedAt: iso(k, 22, 50), grade: g, routineMin: 40,
        stats: {
          workMin: [400, 330, 500, 420, 250, 410, 520][7 - i], wastedMin: [80, 150, 30, 70, 210, 60, 25][7 - i],
          gymMin: [60, 0, 65, 0, 0, 55, 70][7 - i], sleepMin: [470, 430, 480, 455, 520, 440, 475][7 - i],
          score: { A: 0.92, B: 0.8, C: 0.66, D: 0.5 }[g], tasksDone: 6, tasksPlanned: 8, avgProd: 0.86,
        },
      };
    }
    const y = L.addDays(d0, -1);
    days[y].bedAt = iso(y, 23, 25);
    days[d0] = { upAt: iso(d0, 7, 20), routineMin: 45 };
    const add = (b) => blocks.push({ id: uid(), date: d0, kind: 'task', step: 2, fixed: false, ...b });
    add({ title: 'Morning review', plannedStart: '08:05', expectedMin: 15, actualMs: 14 * 60000, doneAt: iso(d0, 8, 20) });
    add({ title: 'Write release animation list', plannedStart: '08:30', expectedMin: 60, actualMs: 52 * 60000, doneAt: iso(d0, 9, 25) });
    add({ title: 'Review SA clips on CJ rig', plannedStart: '09:30', expectedMin: 90, actualMs: 84 * 60000, doneAt: iso(d0, 11, 0) });
    add({ title: 'Export the Good clips', plannedStart: '11:00', expectedMin: 45, actualMs: 41 * 60000, doneAt: iso(d0, 11, 45) });
    add({ title: 'Female walk set', plannedStart: '13:00', expectedMin: 60, actualMs: 40 * 60000, runningSince: n.toISOString() });
    add({ title: 'Car enter / exit clips', plannedStart: '14:00', expectedMin: 60 });
    blocks.push({ id: uid(), date: d0, kind: 'gym', title: 'Gym', plannedStart: '18:00', expectedMin: 60, fixed: true });
    add({ title: 'Weapon clips shortlist', plannedStart: '19:30', expectedMin: 90 });
    add({ title: 'Search online for missing clips', plannedStart: null, expectedMin: 30 });
    // overrun demo (?demo=over): the running task is past its time
    if (params.getAll('demo').includes('over')) {
      const r = blocks.find((b) => b.runningSince); r.actualMs = 72 * 60000;
    }
    if (params.getAll('demo').includes('fresh')) { // empty morning
      return { days: { ...days, [d0]: {} }, blocks: blocks.map((b) => ({ ...b, actualMs: 0, doneAt: null, runningSince: null })) };
    }
    return { days, blocks };
  }
  function demoLoad() {
    let saved = null;
    if (!params.has('reset')) { try { saved = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch (e) { /* private mode */ } }
    const data = saved && saved.day === today() ? saved : { ...demoSeed(), day: today() };
    state.days = data.days; state.blocks = data.blocks;
    if (data.routines) state.routines = data.routines;
    state.user = { email: 'demo' };
  }
  function demoSave() {
    try {
      localStorage.setItem(DEMO_KEY, JSON.stringify({ day: today(), days: state.days, blocks: state.blocks, routines: state.routines }));
    } catch (e) { /* ignore */ }
  }

  // ---------- Supabase backend ----------
  let sb = null;
  async function cloudInit() {
    const cfg = window.CRUNCH_CONFIG || {};
    if (!cfg.supabaseUrl) throw new Error('missing config');
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true } });
    const { data } = await sb.auth.getSession();
    state.user = data.session ? data.session.user : null;
    sb.auth.onAuthStateChange((_e, session) => {
      const had = !!state.user; state.user = session ? session.user : null;
      if (!had && state.user) cloudLoad().then(emit);
    });
    if (state.user) await cloudLoad();
  }
  async function cloudLoad() {
    const from = L.addDays(today(), -30);
    const [kv, days, blocks] = await Promise.all([
      sb.from('kv').select('key,data'),
      sb.from('days').select('date,data').gte('date', from),
      sb.from('blocks').select('id,date,data').gte('date', from),
    ]);
    for (const r of kv.data || []) {
      if (r.key === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...r.data };
      if (r.key === 'steps') state.steps = r.data;
      if (r.key === 'routines') state.routines = r.data;
    }
    // The notification function needs the phone's time zone to know what "07:15" means.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (state.settings.tz !== tz && (kv.data || []).some((r) => r.key === 'settings')) {
      state.settings = { ...state.settings, tz };
      sb.from('kv').upsert({ user_id: state.user.id, key: 'settings', data: state.settings }).then(() => {});
    }
    if (!(kv.data || []).some((r) => r.key === 'steps')) {
      state.settings.tz = tz;
      await sb.from('kv').upsert([
        { user_id: state.user.id, key: 'settings', data: state.settings },
        { user_id: state.user.id, key: 'steps', data: state.steps },
        { user_id: state.user.id, key: 'routines', data: state.routines },
      ]);
    }
    state.days = {};
    for (const r of days.data || []) state.days[r.date] = r.data;
    state.blocks = (blocks.data || []).map((r) => ({ ...r.data, id: r.id, date: r.date }));
    subscribe();
  }
  let channel = null;
  function subscribe() {
    if (channel) return;
    channel = sb.channel('crunch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks' }, (p) => {
        if (p.eventType === 'DELETE') state.blocks = state.blocks.filter((b) => b.id !== p.old.id);
        else {
          const b = { ...p.new.data, id: p.new.id, date: p.new.date };
          const i = state.blocks.findIndex((x) => x.id === b.id);
          if (i >= 0) state.blocks[i] = b; else state.blocks.push(b);
        }
        emit();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'days' }, (p) => {
        if (p.new && p.new.date) { state.days[p.new.date] = p.new.data; emit(); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kv' }, (p) => {
        if (!p.new) return;
        if (p.new.key === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...p.new.data };
        if (p.new.key === 'steps') state.steps = p.new.data;
        if (p.new.key === 'routines') state.routines = p.new.data;
        emit();
      })
      .subscribe();
    // Catch up after the phone wakes from the background.
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) cloudLoad().then(emit); });
  }
  const cloud = {
    block: (b) => sb.from('blocks').upsert({ id: b.id, user_id: state.user.id, date: b.date, data: b }),
    delBlock: (id) => sb.from('blocks').delete().eq('id', id),
    day: (date) => sb.from('days').upsert({ user_id: state.user.id, date, data: state.days[date] }),
    kv: (key) => sb.from('kv').upsert({ user_id: state.user.id, key, data: state[key] }),
  };
  const report = (p) => p && p.then((r) => { if (r && r.error) console.error('[crunch] save failed', r.error); });

  // ---------- public API ----------
  const Store = {
    state, now, today, DEMO, uid,
    on(f) { listeners.add(f); return () => listeners.delete(f); },
    async init() {
      if (DEMO) demoLoad(); else await cloudInit();
      emit();
    },
    async sendCode(email) { return sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }); },
    async verifyCode(email, token) { return sb.auth.verifyOtp({ email, token, type: 'email' }); },
    async signOut() { await sb.auth.signOut(); location.reload(); },
    client: () => sb,

    saveBlock(b) {
      const i = state.blocks.findIndex((x) => x.id === b.id);
      if (i >= 0) state.blocks[i] = b; else state.blocks.push(b);
      if (DEMO) demoSave(); else report(cloud.block(b));
      emit();
    },
    saveBlocks(list) { list.forEach((b) => { const i = state.blocks.findIndex((x) => x.id === b.id); if (i >= 0) state.blocks[i] = b; }); if (DEMO) demoSave(); else list.forEach((b) => report(cloud.block(b))); emit(); },
    deleteBlock(id) {
      state.blocks = state.blocks.filter((b) => b.id !== id);
      if (DEMO) demoSave(); else report(cloud.delBlock(id));
      emit();
    },
    patchDay(date, patch) {
      state.days[date] = { ...(state.days[date] || {}), ...patch };
      if (DEMO) demoSave(); else report(cloud.day(date));
      emit();
    },
    setKV(key, value) {
      state[key] = value;
      if (DEMO) demoSave(); else report(cloud.kv(key));
      emit();
    },
  };
  window.Store = Store;
})();
