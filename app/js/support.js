// Crunch - Report a bug or an idea. Reports are saved with your data (kv "feedback"); when you ask Claude
// to update the app, Claude reads them, asks you about each one, builds, and marks them done.
(function () {
  const Store = window.Store, S = Store.state, { Sound } = window.FX;
  const esc = (s) => window.UI.esc(s);
  const list = () => S.feedback || [];

  function screenNow() {
    if (window.Focus && window.Focus.isOpen()) return 'Focus';
    if (window.Flows && window.Flows.isOpen()) return 'a full-screen flow';
    const v = document.querySelector('.view.tab-active');
    return v ? v.dataset.name[0].toUpperCase() + v.dataset.name.slice(1) : 'Today';
  }
  const when = (iso) => { const d = new Date(iso); return `${window.UI.shortDate(window.Logic.dateKey(d))}, ${window.UI.timeOf(iso)}`; };

  function open() {
    const app = window.app, screen = screenNow();
    let type = 'bug';
    const past = list().slice().reverse();
    const popup = app.popup.create({
      swipeToClose: false, push: true,
      content: `<div class="popup support-popup"><div class="view"><div class="page">
        <div class="navbar"><div class="navbar-bg"></div><div class="navbar-inner">
          <div class="left"><a class="link popup-close">Cancel</a></div><div class="title">Report</div>
          <div class="right"><a class="link" data-send style="font-weight:600">Send</a></div></div></div>
        <div class="page-content">
          <div class="seg-wrap" style="margin-top:20px"><div class="segmented segmented-strong">
            <a class="button button-active" data-type="bug">Bug</a><a class="button" data-type="idea">Idea</a>
            <span class="segmented-highlight"></span></div></div>
          <div class="list list-strong inset"><ul><li class="item-content item-input"><div class="item-inner"><div class="item-input-wrap">
            <textarea name="text" class="sup-text" placeholder="What went wrong? What did you expect?"></textarea></div></div></li></ul></div>
          <div class="block-footer" style="margin:-20px 32px 20px">Sent from ${esc(screen)}, with the time. It stays in Crunch until you ask Claude to update the app.</div>
          ${past.length ? `<div class="block-title">Sent</div><div class="list list-strong list-dividers inset"><ul>${past.map((r) => `<li><div class="item-content"><div class="item-inner sup-row">
              <div class="sup-top"><span class="sup-type">${r.type === 'idea' ? 'Idea' : 'Bug'}</span><span class="sup-when">${when(r.at)}</span><span class="sup-st ${r.status === 'done' ? 'green' : ''}">${r.status === 'done' ? 'Done' : 'New'}</span></div>
              <div class="sup-body">${esc(r.text)}</div></div></div></li>`).join('')}</ul></div>` : ''}
          <div style="height:30px"></div>
        </div></div></div></div>`,
      on: { opened(p) { p.el.querySelector('[name=text]').focus(); }, closed(p) { p.destroy(); } },
    });
    const el = popup.el, ta = el.querySelector('[name=text]');
    el.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
      type = b.dataset.type;
      el.querySelectorAll('[data-type]').forEach((x) => x.classList.toggle('button-active', x === b));
      ta.placeholder = type === 'idea' ? 'What should Crunch do next?' : 'What went wrong? What did you expect?';
    }));
    el.querySelector('[data-send]').addEventListener('click', () => {
      const text = ta.value.trim(); if (!text) { ta.focus(); return; }
      Store.setKV('feedback', [...list(), { id: Store.uid(), type, text, screen, at: Store.now().toISOString(), status: 'new' }]);
      Sound.check();
      popup.close();
      app.toast.create({ text: type === 'idea' ? 'Idea saved' : 'Bug saved', closeTimeout: 1800, cssClass: 'undo-toast' }).open();
    });
    popup.open();
  }
  const count = () => { const n = list().filter((r) => r.status !== 'done').length; return n ? `${n} new` : ''; };

  window.Support = { open, count };
})();
