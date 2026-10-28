// Crunch - bootstrap: Framework7 app, routing of taps, render loop, login, morning auto-start.
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
  function render() {
    if (window.Week && window.Week.isDragging()) return;
    UI.applyTheme();
    UI.renderToday();
    if (activeTab === 'week') window.Week.render();
    if (activeTab === 'plan') UI.renderPlan();
    if (activeTab === 'history') UI.renderHistory();
  }

  // One delegated tap handler for every page and flow.
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action],[data-start],[data-pause],[data-done],[data-block],[data-step]');
    if (!t || t.closest('.swipeout-actions-right')) return;
    if (t.dataset.start) return UI.start(t.dataset.start);
    if (t.dataset.pause) return UI.pause(t.dataset.pause);
    if (t.dataset.done) return UI.done(t.dataset.done);
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
      case 'night': return window.Flows.night();
      case 'streak': return app.dialog.alert(`${L.streak(S.days, Store.today())} days in a row at 75% of your work goal or more. The flame grows with every task finished on time today.`, 'Streak');
      case 'finish': return finishAsk();
      case 'more': return moreMenu();
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
    if (!(r && r.kind === 'gym') && !day.finishedAt) items.push({ text: 'Start gym', icon: ic('bolt_fill'), onClick: () => UI.startGym() });
    if (!day.finishedAt) items.push({ text: 'Finish the day', icon: ic('moon_fill'), onClick: finishAsk });
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

  // ---------- login (cloud mode) ----------
  function login() {
    const el = document.createElement('div');
    el.className = 'login';
    el.innerHTML = `<img src="icons/icon-192.png" alt=""><h1>Crunch</h1><p id="msg">Sign in to sync your iPhone and PC.</p>
      <input id="em" type="email" placeholder="Email" autocomplete="username" inputmode="email" autocapitalize="off">
      <input id="pw" type="password" placeholder="Password" autocomplete="current-password">
      <button class="btn big fill" id="go">Sign In</button>
      <button class="link-btn" id="new">Create an account</button><div class="err" id="err"></div>`;
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s), err = $('#err');
    let creating = false;
    $('#new').addEventListener('click', () => {
      creating = !creating; err.textContent = '';
      $('#msg').textContent = creating ? 'Choose a password of at least 6 characters.' : 'Sign in to sync your iPhone and PC.';
      $('#go').textContent = creating ? 'Create Account' : 'Sign In';
      $('#new').textContent = creating ? 'I already have an account' : 'Create an account';
      $('#pw').autocomplete = creating ? 'new-password' : 'current-password';
    });
    const go = async () => {
      const email = $('#em').value.trim(), pw = $('#pw').value;
      err.textContent = '';
      if (!email || !pw) { err.textContent = 'Enter your email and password.'; return; }
      $('#go').disabled = true;
      const { data, error } = creating ? await Store.signUp(email, pw) : await Store.signIn(email, pw);
      $('#go').disabled = false;
      if (error) { err.textContent = error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message; return; }
      if (creating && !data.session) {  // the project asks to confirm the email first
        $('#new').click();
        $('#msg').textContent = `Open the email sent to ${email}, tap the link, then sign in here.`;
        return;
      }
      location.reload();  // start fresh with the signed-in user
    };
    $('#go').addEventListener('click', go);
    $('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  // ---------- start ----------
  Store.on(() => render());
  Store.init().then(() => {
    if (!Store.DEMO && !S.user) login();
    window.Week.init();
    render();
    setInterval(() => { if (activeTab === 'today') UI.tickToday(); }, 1000);
    setInterval(render, 60000);
    const screen = params.get('screen');
    if (screen) { openScreen(screen); return; }
    maybeMorning();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeMorning(); });
  }).catch((e) => {
    if (e.message === 'missing config') {  // installed before the cloud was set up: say so calmly
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

  // Screenshot / review hooks: ?demo=1&screen=week|plan|history|settings|task|reveal|routine|tomorrow|morning|night|celebrate
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
      case 'passed': { // demo: a good day
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
