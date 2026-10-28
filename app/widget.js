// Crunch widget for the Scriptable app (iPhone home screen + lock screen).
// Shows the time left today and the running task, both counting down live. Reads your Crunch data directly.
// Install: see https://yassirpersonelle-oss.github.io/crunch/widget.html
const URL_ = 'https://djrscrzewbgvolkiiiax.supabase.co/rest/v1';
const KEY = 'sb_publishable_RNEKpw9dnYwr9aXLQMDIHA_rMsCCCcc';
const GREEN = new Color('#30d158'), ORANGE = new Color('#ff9f0a'), RED = new Color('#ff453a'), GREY = new Color('#8e8e93');

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (d, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const x = new Date(d); x.setHours(h, m, 0, 0); return x; };

async function get(path) {
  const r = new Request(`${URL_}/${path}`);
  r.headers = { apikey: KEY };
  return r.loadJSON();
}

async function load() {
  const now = new Date(), today = dateKey(now);
  const [kv, blocks] = await Promise.all([get('kv?select=key,data&key=eq.settings'), get(`blocks?select=id,data&date=eq.${today}`)]);
  const st = { wake: '07:00', bed: '23:00', releaseAt: '2026-11-14T18:00', ...((kv && kv[0] && kv[0].data) || {}) };
  const list = (blocks || []).map((b) => b.data);
  const run = list.find((b) => b.runningSince);
  const next = list.filter((b) => !b.doneAt && !b.runningSince && b.plannedStart).sort((a, b) => a.plannedStart.localeCompare(b.plannedStart))[0];
  let bed = at(now, st.bed);
  const rel = new Date(st.releaseAt);
  if (rel < bed) bed = rel;
  let taskEnd = null, over = false;
  if (run) {
    const act = (run.actualMs || 0) + (now - new Date(run.runningSince));
    taskEnd = new Date(now.getTime() + run.expectedMin * 60000 - act);
    over = taskEnd < now;
  }
  return { now, bed, run, next, taskEnd, over };
}

function timer(stack, date, size, color) {
  const t = stack.addDate(date);
  t.applyTimerStyle();
  t.font = Font.boldMonospacedSystemFont(size);
  t.textColor = color;
  t.minimumScaleFactor = 0.6;
  return t;
}
function text(stack, s, size, color, bold) {
  const t = stack.addText(s);
  t.font = bold ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
  return t;
}

async function build() {
  const d = await load();
  const w = new ListWidget();
  const family = config.widgetFamily || 'small';
  w.refreshAfterDate = new Date(Date.now() + 5 * 60000);
  w.url = 'https://yassirpersonelle-oss.github.io/crunch/';

  if (family === 'accessoryRectangular') {  // lock screen, wide
    if (d.run) {
      text(w, d.run.title, 13, Color.white(), true);
      timer(w, d.taskEnd, 22, Color.white());
    } else {
      text(w, 'Left today', 13, Color.white(), true);
      timer(w, d.bed, 22, Color.white());
    }
    return w;
  }
  if (family === 'accessoryCircular' || family === 'accessoryInline') {  // lock screen, small
    timer(w, d.run ? d.taskEnd : d.bed, 14, Color.white());
    return w;
  }

  // home screen
  w.backgroundColor = Color.black();
  w.setPadding(14, 14, 14, 14);
  text(w, 'Left today', 12, GREY);
  timer(w, d.bed, 26, Color.white());
  w.addSpacer();
  if (d.run) {
    text(w, d.run.title, 14, Color.white(), true);
    timer(w, d.taskEnd, 20, d.over ? RED : (d.run.kind === 'gym' ? GREEN : ORANGE));
    if (d.over) text(w, 'over time', 11, RED);
  } else if (d.next) {
    text(w, 'Next', 12, GREY);
    text(w, `${d.next.plannedStart}  ${d.next.title}`, 14, Color.white(), true);
  } else {
    text(w, 'Nothing running', 14, GREY);
  }
  return w;
}

const widget = await build();
if (config.runsInWidget || config.runsInAccessoryWidget) Script.setWidget(widget);
else await widget.presentSmall();
Script.complete();
