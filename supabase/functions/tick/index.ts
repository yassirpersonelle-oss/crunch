// Crunch "tick": called every minute by pg_cron. Decides which notifications are due for each user and
// sends them by Web Push. Each notification has a tag; notif_log makes sure a tag is sent only once.
// Because it reads the live data each minute, editing or deleting a task cancels its alerts by itself.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const MIN = 60000;
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails('mailto:crunch@example.com', Deno.env.get('VAPID_PUBLIC')!, Deno.env.get('VAPID_PRIVATE')!);

type Block = {
  id: string; date: string; kind: string; title: string; plannedStart: string | null; expectedMin: number;
  actualMs?: number; runningSince?: string | null; doneAt?: string | null; pausedAt?: string | null;
};
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmt = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`);

// The user's wall clock: date key + minutes since midnight, in their time zone.
function wall(tz: string, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('no', { status: 401 });
  const now = new Date();
  const { data: subs } = await sb.from('push_subs').select('endpoint,user_id,keys');
  const users = [...new Set((subs || []).map((s) => s.user_id))];
  let sent = 0;

  for (const uid of users) {
    const { data: kv } = await sb.from('kv').select('key,data').eq('user_id', uid).eq('key', 'settings').maybeSingle();
    const st = { wake: '07:00', bed: '23:00', tz: 'Europe/Paris', idleSnoozeUntil: null as string | null, ...(kv?.data || {}) };
    const w = wall(st.tz, now);
    const [{ data: dayRow }, { data: rows }] = await Promise.all([
      sb.from('days').select('data').eq('user_id', uid).eq('date', w.date).maybeSingle(),
      sb.from('blocks').select('id,date,data').eq('user_id', uid).eq('date', w.date),
    ]);
    const day = dayRow?.data || {};
    const blocks: Block[] = (rows || []).map((r) => ({ ...r.data, id: r.id, date: r.date }));
    const out: { tag: string; title: string; body: string }[] = [];
    const wake = hm(st.wake), rawBed = hm(st.bed), bed = rawBed <= wake ? rawBed + 1440 : rawBed;

    // 1) a planned task's start time
    for (const b of blocks) {
      if (!b.plannedStart || b.doneAt || b.runningSince) continue;
      const s = hm(b.plannedStart);
      if (w.min >= s && w.min < s + 3) out.push({ tag: `start:${b.id}:${b.plannedStart}`, title: `Start: ${b.title}`, body: `${fmt(b.expectedMin)} planned · tap to open Crunch` });
    }

    // 2) Overtime push notifications removed per user preference (no nagging when over time).
    const run = blocks.find((b) => b.runningSince);

    // 3) Idle nudges: start at 5 min idle, repeat every 2 min while awake unless snoozed (nap / class)
    const snoozed = st.idleSnoozeUntil && now.getTime() < new Date(st.idleSnoozeUntil).getTime();
    if (day.upAt && !day.finishedAt && !run && !snoozed && w.min >= wake && w.min < bed) {
      const marks = [day.upAt, day.lastIdleAckAt, ...blocks.flatMap((b) => [b.doneAt, b.pausedAt])].filter(Boolean).map((x) => new Date(x as string).getTime());
      const lastMark = Math.max(...marks);
      const idle = (now.getTime() - lastMark) / MIN;
      if (idle >= 5) {
        const k = Math.floor(idle / 2);
        out.push({
          tag: `idle:${w.date}:${lastMark}:${k}`,
          title: `Idle ${fmt(idle)} — What are you doing?`,
          body: 'Start a task, backfill what you were doing, or pause alerts for class/nap.',
        });
      }
    }

    // 4) wind down 1h before sleep + bedtime
    if (!day.finishedAt) {
      if (w.min >= bed - 60 && w.min < bed) out.push({ tag: `wind:${w.date}`, title: '1h until sleep — Finish the day', body: 'Wrap up and review your Plan vs. Reality.' });
      if (w.min >= bed && w.min < bed + 60) out.push({ tag: `bed:${w.date}`, title: 'Bedtime', body: 'Finish the day and start your night routine.' });
    }
    // 5) not up yet
    if (!day.upAt && w.min >= wake + 15 && w.min < wake + 120) out.push({ tag: `wake:${w.date}`, title: 'Are you up?', body: 'Tap to start your morning routine.' });
    // 6) the day was finished (on any device)
    const prod = day.stats?.prod;
    if (day.finishedAt && prod != null) out.push({ tag: `fin:${w.date}`, title: `Your day: ${Math.round(prod * 100)}% productive`, body: 'Tap to see your results.' });

    for (const n of out) {
      const { error } = await sb.from('notif_log').insert({ user_id: uid, tag: n.tag });
      if (error) continue; // already sent
      for (const s of (subs || []).filter((x) => x.user_id === uid)) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ ...n, tag: n.tag.split(':')[0] }), { TTL: 600 });
          sent++;
        } catch (e) {
          if (e.statusCode === 404 || e.statusCode === 410) await sb.from('push_subs').delete().eq('endpoint', s.endpoint);
        }
      }
    }
  }
  // keep the log small
  await sb.from('notif_log').delete().lt('sent_at', new Date(now.getTime() - 3 * 86400000).toISOString());
  return Response.json({ users: users.length, sent });
});
