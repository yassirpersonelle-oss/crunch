-- Crunch notifications: call the "tick" function every minute. Run once in Supabase: SQL Editor -> paste -> Run.
-- Replace CRON_SECRET_HERE with CRON_SECRET from supabase/.secrets.env (never commit the real value).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('crunch-tick') where exists (select 1 from cron.job where jobname = 'crunch-tick');
select cron.schedule('crunch-tick', '* * * * *', $$
  select net.http_post(
    url := 'https://djrscrzewbgvolkiiiax.supabase.co/functions/v1/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'CRON_SECRET_HERE'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);
