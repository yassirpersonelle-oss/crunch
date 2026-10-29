// Crunch - bootstrap: Framework7 app, routing of taps, render loop, morning auto-start.
(function () {
  const L = window.Logic, Store = window.Store, S = Store.state, UI = window.UI;
  const params = new URLSearchParams(location.search);
  if (params.has('sim')) document.documentElement.classList.add('sim');

  const app = new Framework7({
    el: '#app', theme: 'ios', darkMode: true, colors: { primary: '#ff9f0a' },
    touch: { tapHold: false }, iosTranslucentBars: true,
  });
  window.app = app;

  let activeTab = 'today';
  let lastTouch = Date.now();
  ['pointerdown', 'keydown', 'scroll', 'wheel'].forEach((ev) => document.addEventListener(ev, () => { lastTouch = Date.now(); }, { passive: true, capture: true }));
  window.addEventListener('focus-closed', () => { lastTouch = Date.now(); });
  function render() {
    if (window.Week && window.Week.isDragging()) return;
    UI.applyTheme();
    // don't rebuild Today under your thumbs while you type a fast-add task
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#today input');
    if (!typing) UI.renderToday();
    if (window.Focus) window.Focus.render();
    if (activeTab === 'week') window.Week.render();
    if (activeTab === 'plan') UI.renderPlan();
    if (activeTab === 'history') UI.renderHistory();
  }

  // One delegated tap handler for every page and flow.
  document.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-complete],[data-remove]');
    if (sw) {
      const li = sw.closest('li.swipeout'); if (li) app.swipeout.close(li);
      return sw.dataset.complete ? UI.complete(sw.dataset.complete) : UI.remove(sw.dataset.remove);
    }
    const t = e.target.closest('[data-action],[data-start],[data-pause],[data-done],[data-extend],[data-block],[data-step]');
    if (!t || t.closest('.swipeout-actions-right')) return;
    if (t.dataset.start) return UI.start(t.dataset.start);
    if (t.dataset.pause) return UI.pause(t.dataset.pause);
    if (t.dataset.done) return UI.done(t.dataset.done);
    if (t.dataset.extend) return UI.extendSheet(t.dataset.extend);
    if (t.dataset.step && t.closest('#plan')) return UI.stepMenu(+t.dataset.step);
    if (t.dataset.block) {
      if (t.closest('#flow')) return; // flows handle their own rows
      const b = S.blocks.find((x) => x.id === t.dataset.block); if (b) UI.blockMenu(b); return;
    }
    switch (t.dataset.action) {
      case 'new-task': return UI.taskEditor({ date: activeTab === 'week' ? window.Week.selected() : Store.today() });
      case 'gym': return UI.startGym();
      case 'settings': return UI.settingsPopup();
      case 'week-today': return window.Week.goToday();
      case 'reveal': return window.Flows.reveal(Store.today(), false);
      case 'plan-vs-actual': return window.Flows.planVsActual(Store.today(), false);
      case 'night': return window.Flows.night();
      case 'streak': return app.dialog.alert(`${L.streak(S.days, Store.today())} days in a row at 75% of your work goal or more. The flame grows with every task finished on time today.`, 'Streak');
      case 'finish': return finishAsk();
      case 'more': return moreMenu();
      case 'timer-mode': return UI.toggleTimer();
      case 'hero-mode': return UI.toggleHeroMode();
      case 'sleep-wake': return UI.sleepWakeSheet();
      case 'idle-explain': return UI.idleExplainSheet();
      case 'idle-snooze': return UI.idleSnoozeSheet();
      case 'focus': return window.Focus.open();
      case 'support': return UI.settingsPopup && window.Support.open();
      default:
    }
  });
  function finishAsk() {
    const open = S.blocks.filter((b) => b.date === Store.today() && b.kind === 'task' && !b.doneAt).length;
    app.dialog.create({
      title: 'Finish the day?', text: open ? `${open} task${open > 1 ? 's' : ''} still open. You can carry them over to tomorrow.` : 'Everything is done.',
      buttons: [{ text: 'Cancel' }, { text: 'Finish', bold: true, onClick: () => window.Flows.finishDay() }],
    }).open();
  }
  // Today's "More" button: the less frequent actions live here, so the hero stays calm.
  function moreMenu() {
    const r = UI.running(), day = S.days[Store.today()] || {};
    const ic = (n) => `<i class="f7-icons">${n}</i>`;
    const items = [{ text: 'Add a task', icon: ic('plus'), onClick: () => UI.taskEditor({ date: Store.today() }) }];
    if (r) items.push({ text: 'Extend running task', icon: ic('plus_circle_fill'), onClick: () => UI.extendSheet(r) });
    if (!r && !day.finishedAt) {
      items.push({ text: 'Explain idle / Backfill task', icon: ic('arrow_counterclockwise'), onClick: () => UI.idleExplainSheet() });
      items.push({ text: 'Pause idle alerts (Nap / Class)', icon: ic('moon_zzz_fill'), onClick: () => UI.idleSnoozeSheet() });
    }
    if (!(r && r.kind === 'gym') && !day.finishedAt) items.push({ text: 'Start gym', icon: ic('bolt_fill'), onClick: () => UI.startGym() });
    items.push({ text: 'Sleep & Wake times', icon: ic('alarm_fill'), onClick: () => UI.sleepWakeSheet() });
    if (!day.finishedAt) items.push({ text: 'Finish the day', icon: ic('moon_fill'), onClick: finishAsk });
    items.push({ text: 'Report a bug or idea', icon: ic('ant_fill'), onClick: () => window.Support.open() });
    app.actions.create({ cssClass: 'more-menu', buttons: [items, [{ text: 'Cancel', bold: true }]] }).open();
  }

  // Swipe-to-delete on any task row
  document.addEventListener('swipeout:deleted', (e) => {
    const li = e.target.closest('li[data-id]'); if (li) Store.deleteBlock(li.dataset.id);
  });

  document.querySelectorAll('.view.tab').forEach((v) => v.addEventListener('tab:show', () => {
    activeTab = v.dataset.name;
    render();
    if (activeTab === 'week') window.Week.scrollToNow();
  }));

  // ---------- start ----------
  Store.on(() => render());
  Store.init().then(() => {
    if (!S.settings.m5) {
      const walls = S.blocks.filter((b) => b.kind === 'gym' && b.fixed);
      if (walls.length) Store.saveBlocks(walls.map((b) => ({ ...b, fixed: false })));
      Store.setKV('settings', { ...S.settings, m5: true });
    }
    window.Week.init();
    render();
    setInterval(() => {
      if (activeTab === 'today') UI.tickToday();
      if (window.Focus) window.Focus.tick();
      // Focus mode opens by itself after 20 s untouched while a task runs on Today
      const busy = window.Flows.isOpen() || document.querySelector('.modal-in, #celebrate:not([hidden])') || window.Focus.isOpen();
      if (activeTab === 'today' && UI.running() && !busy && Date.now() - lastTouch > 20000) window.Focus.open();
    }, 1000);
    setInterval(render, 60000);
    const screen = params.get('screen');
    if (screen) { openScreen(screen); return; }
    maybeMorning();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeMorning(); });
  }).catch((e) => {
    if (e.message === 'missing config') {
      const el = document.createElement('div'); el.className = 'login';
      el.innerHTML = `<img src="icons/icon-192.png" alt=""><h1>Almost ready</h1><p>Crunch is installed. Syncing between your iPhone and PC is being set up, so this screen updates by itself. Open the app again in a little while.</p>`;
      document.body.appendChild(el); return;
    }
    document.getElementById('today').innerHTML = `<div class="wrap"><p class="red">Could not start: ${UI.esc(e.message)}</p></div>`;
  });

  function maybeMorning() {
    if (!S.user || window.Flows.isOpen()) return;
    const n = Store.now(), day = S.days[Store.today()] || {};
    if (n.getHours() >= 4 && !day.upAt && !day.finishedAt) window.Flows.morning();
  }

  function openScreen(s) {
    const tab = (name) => app.tab.show(`#view-${name}`);
    const key = Store.today();
    switch (s) {
      case 'week': case 'plan': case 'history': tab(s); break;
      case 'settings': UI.settingsPopup(); break;
      case 'task': UI.taskEditor({}); break;
      case 'edit': UI.taskEditor({ block: S.blocks.find((b) => b.plannedStart === '14:00') }); break;
      case 'morning': window.Flows.morning(); break;
      case 'overview': window.Flows.overview(); break;
      case 'routine': window.Flows.night(); break;
      case 'tomorrow': window.Flows.planTomorrow(); break;
      case 'night': window.Flows.bed(); break;
      case 'reveal': window.Flows.finishDay(); break;
      case 'pva': window.Flows.planVsActual(key, false); break;
      case 'passed': {
        window.Flows.finishDay();
        const d = S.days[key];
        Store.patchDay(key, { grade: 'B', stats: { ...d.stats, score: 0.82, prod: 545 / 480, workMin: 545, tasksDone: 7, tasksPlanned: 8, wastedMin: 35, gymMin: 62, avgProd: 0.97, lateUpMin: 5 } });
        window.Flows.reveal(key, true); break;
      }
      case 'celebrate': setTimeout(() => UI.celebrate(true, -6, 5, { actualMs: 54 * 60000 }), 600); break;
      case 'overcel': setTimeout(() => UI.celebrate(false, 12, 0, { actualMs: 72 * 60000 }), 600); break;
      case 'menu': UI.blockMenu(S.blocks.find((b) => b.plannedStart === '14:00')); break;
      default:
    }
    void key;
  }

  window.App = { render };

  if ('serviceWorker' in navigator && !Store.DEMO && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
