# Crunch – agent rules

Personal productivity PWA (one user, no login). Vanilla JS + Framework7 in `app/`, Python/tkinter desktop
companion (floating capsule + wallpaper) in `desktop/crunch_desktop.pyw`, Supabase backend in `supabase/`
(push notifications from the `tick` edge function, run every minute by pg_cron).

## Bug & idea log
- The in-app "Report" sheet (`app/js/support.js`) saves reports to Supabase `kv` row `key = 'feedback'`
  as `[{id, type: 'bug'|'idea', text, screen, at, status: 'new'|'done'}]`.
- Read it with the public anon key from `app/config.js` (same as the app):
  `GET {supabaseUrl}/rest/v1/kv?key=eq.feedback&select=data` with header `apikey: {supabaseKey}`.
- Workflow when asked to "update the app" / "check the log": read all `new` reports, grill the user about
  them (rounds, numbered questions with recommended answers), build only after shared understanding, then
  set each implemented report's `status` to `'done'` (PATCH the whole `data` array back).

## Code map
- Script load order (index.html): config, logic, store, fx, roll, ui, home, week, flows, push, focus, support, app.
- `logic.js` = pure functions (UMD, testable). `store.js` = state + Supabase sync (tables kv/days/blocks).
- Data model: settings/steps/routines/feedback in `kv`; per-day record in `days`; tasks in `blocks`.
- Keep the desktop app (`crunch_desktop.pyw` `status()`) and the `tick` function in sync with `logic.js`
  when changing time math (wake/bed, idle, overtime).

## Conventions
- No build step, no framework beyond Framework7; plain ES2020 in IIFEs exposing `window.X`.
- Primary device is an iPhone home-screen PWA: test layouts for iOS safe areas / keyboard / `100dvh`.
  iOS web apps can't vibrate via `navigator.vibrate`; haptics go through the ios-haptics switch (`fx.js`).
- Tests: `node tests/logic.test.js` – add tests for any `logic.js` change.
- Demo mode for manual checks: `?demo`, `?demo=over`, `?demo=fresh`, `?at=<ISO>` fixed clock.
- Secrets: never print or commit `supabase/.secrets.env`.
