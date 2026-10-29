"""Crunch for Windows: an always-on-top speedrun timer island + a live red countdown wallpaper.

One light process (tkinter + Pillow). Reads the same Supabase data as the phone app.
Default island: pure speedrun countdown number (no text clutter).
Click the island -> toggles task & day details. Double-click or Right-click -> opens the full PC app.
Run:  pythonw crunch_desktop.pyw          (no sign-in: reads your Crunch data directly)
      python  crunch_desktop.pyw --demo   (fake data, no login: for screenshots/tests)
"""
import ctypes
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import winreg
from datetime import datetime, timedelta, timezone
import tkinter as tk

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.environ.get('APPDATA', HERE), 'Crunch')
os.makedirs(DATA, exist_ok=True)
CFG = json.load(open(os.path.join(HERE, 'config.json'), encoding='utf-8'))
DEMO = '--demo' in sys.argv
BRAVE = r'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'

ORANGE, RED, GREEN, BLUE, GREY, WHITE = '#ff9f0a', '#ff453a', '#30d158', '#5e5ce6', '#8e8e93', '#ffffff'
KEY = '#010101'  # transparent colour of the capsule window


# ---------------------------------------------------------------- data
def hm(s):
    h, m = s.split(':')
    return int(h) * 60 + int(m)


def bed_min_of(st):
    w = hm(st.get('wake', '07:00'))
    b = hm(st.get('bed', '23:00'))
    return b + 1440 if b <= w else b


def iso(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone().replace(tzinfo=None) if s else None


class Cloud:
    """Reads Crunch's rows with the project key: one person uses Crunch, so there is no sign-in."""

    def _req(self, method, path, body=None):
        url = CFG['supabaseUrl'] + path
        headers = {'apikey': CFG['supabaseKey'], 'Content-Type': 'application/json'}
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read() or b'null')

    def save_block(self, b):
        self._req('PATCH', f"/rest/v1/blocks?id=eq.{b['id']}", {'data': b})

    def save_settings(self, st):
        self._req('PATCH', '/rest/v1/kv?key=eq.settings', {'data': st})

    def load(self):
        today = datetime.now().date()
        y = today - timedelta(days=1)
        kv = self._req('GET', '/rest/v1/kv?select=key,data')
        days = self._req('GET', f'/rest/v1/days?select=date,data&date=gte.{y - timedelta(days=13)}')
        blocks = self._req('GET', f'/rest/v1/blocks?select=id,date,data&date=eq.{today}')
        st = {'wake': '07:00', 'bed': '23:00', 'releaseAt': '2026-11-14T18:00', 'startDate': '2026-10-28'}
        steps = []
        for r in kv or []:
            if r['key'] == 'settings':
                st.update(r['data'])
            if r['key'] == 'steps':
                steps = r['data']
        return {'settings': st, 'steps': steps, 'days': {r['date']: r['data'] for r in days or []},
                'blocks': [dict(r['data'], id=r['id'], date=r['date']) for r in blocks or []]}


def demo_data():
    now = datetime.now()
    t = now.date().isoformat()
    y = (now.date() - timedelta(days=1)).isoformat()
    return {
        'settings': {'wake': '07:00', 'bed': '23:00', 'releaseAt': '2026-11-14T18:00', 'startDate': '2026-10-28'},
        'steps': [{'n': 2, 'title': 'Animations', 'start': t, 'end': t}],
        'days': {y: {'finishedAt': 'x', 'stats': {'prod': 0.92}, 'bedAt': (now - timedelta(hours=14)).isoformat()},
                 t: {'upAt': (now - timedelta(hours=6)).isoformat()}},
        'blocks': [{'id': 'a', 'date': t, 'kind': 'task', 'title': 'Female walk set', 'expectedMin': 60,
                    'actualMs': 40 * 60000, 'runningSince': now.isoformat()}],
    }


# ---------------------------------------------------------------- maths (mirrors app/js/logic.js)
def hours_left(now, st):
    release = datetime.fromisoformat(st['releaseAt'])
    wake_m = hm(st.get('wake', '07:00'))
    bed_m = bed_min_of(st)
    work = 0.0
    d = now.date() - timedelta(days=1)
    while d <= release.date():
        a = max(datetime.combine(d, datetime.min.time()) + timedelta(minutes=wake_m), now)
        b = min(datetime.combine(d, datetime.min.time()) + timedelta(minutes=bed_m), release)
        if b > a:
            work += (b - a).total_seconds()
        d += timedelta(days=1)
    day0 = datetime.combine(now.date(), datetime.min.time())
    prev_bed = day0 - timedelta(days=1) + timedelta(minutes=bed_m)
    target_bed = prev_bed if (bed_m > 1440 and now < prev_bed) else day0 + timedelta(minutes=bed_m)
    today_left_s = max(0, int((min(target_bed, release) - max(now, day0 + timedelta(minutes=wake_m))).total_seconds()))
    return work / 3600, max(0, (release - now).total_seconds()) / 3600, today_left_s


def actual_ms(b, now):
    run = iso(b.get('runningSince'))
    return (b.get('actualMs') or 0) + ((now - run).total_seconds() * 1000 if run else 0)


def prod(d):
    p = ((d or {}).get('stats') or {}).get('prod')
    return None if p is None else p


def pct(d):
    p = prod(d)
    return '' if p is None else f'{round(p * 100)}%'


def streak(days, today):
    k = today if days.get(today, {}).get('finishedAt') else (datetime.fromisoformat(today) - timedelta(days=1)).date().isoformat()
    n = 0
    while days.get(k, {}).get('finishedAt') and (prod(days[k]) or 0) >= 0.75:
        n += 1
        k = (datetime.fromisoformat(k) - timedelta(days=1)).date().isoformat()
    return n


def clock(ms):
    s = max(0, int(ms // 1000))
    m = s // 60
    return f'{m:02d}:{s % 60:02d}' if m < 100 else f'{m // 60}:{m % 60:02d}:{s % 60:02d}'


def status(data, now):
    """Returns (big_number_str, big_colour, detail_segments, outline_colour)."""
    st = data['settings']
    today = now.date().isoformat()
    day = data['days'].get(today, {})
    _, _, left = hours_left(now, st)
    day_clock = f'{left // 3600}:{left // 60 % 60:02d}:{left % 60:02d}'
    run = next((b for b in data['blocks'] if b.get('runningSince')), None)
    mins = now.hour * 60 + now.minute
    bed_m = bed_min_of(st)
    snooze_until = iso(st.get('idleSnoozeUntil'))
    is_snoozed = bool(snooze_until and snooze_until > now)

    big_num = day_clock
    big_col = RED if left < 7200 else WHITE
    segs = [(f'{day_clock} left today', RED if left < 7200 else WHITE)]

    if day.get('bedAt') or (not day.get('upAt') and mins < hm(st['wake'])):
        big_num, big_col = day_clock, GREY
        segs.append(('Sleeping', GREY))
    elif day.get('finishedAt'):
        big_num, big_col = pct(day) or 'DONE', GREEN
        segs.append((f'Day done · {pct(day)}'.rstrip(' ·'), GREEN))
    elif run:
        act, exp = actual_ms(run, now), run['expectedMin'] * 60000
        over = act > exp
        col = RED if over else (GREEN if run.get('kind') == 'gym' else GREEN)
        big_num = f'+{clock(act - exp)}' if over else clock(exp - act)
        big_col = col
        title = run['title'] if len(run['title']) <= 24 else run['title'][:23] + '…'
        segs.append((title, WHITE))
    elif is_snoozed:
        rem_ms = (snooze_until - now).total_seconds() * 1000
        big_num, big_col = clock(rem_ms), BLUE
        segs.append((st.get('idleSnoozeReason') or 'Paused', BLUE))
    else:
        marks = [iso(day.get('upAt')), iso(day.get('lastIdleAckAt'))] + [iso(b.get(k)) for b in data['blocks'] for k in ('doneAt', 'pausedAt')]
        marks = [m for m in marks if m]
        idle_s = max(0, int((now - max(marks)).total_seconds())) if marks else 0
        if idle_s >= 300:
            big_num, big_col = f'-{clock(idle_s * 1000)}', RED
            segs.append((f'Idle {idle_s // 60}m', RED))
        else:
            big_num, big_col = day_clock, RED if left < 7200 else WHITE
            segs.append(('Idle', GREY))

    segs.append((f'🔥 {streak(data["days"], today)}', ORANGE))
    outline = None
    if not day.get('finishedAt'):
        if mins >= bed_m or (run and actual_ms(run, now) > run['expectedMin'] * 60000):
            outline = RED
        elif mins >= bed_m - 60:
            outline = ORANGE
    return big_num, big_col, segs, outline


# ---------------------------------------------------------------- wallpaper
SPI_SETDESKWALLPAPER = 20


def font(size, bold=True):
    from PIL import ImageFont
    for name in (('seguibl.ttf' if bold else 'segoeui.ttf'), 'segoeuib.ttf', 'arialbd.ttf', 'consolab.ttf'):
        try:
            return ImageFont.truetype(os.path.join(os.environ['WINDIR'], 'Fonts', name), size)
        except OSError:
            continue
    return ImageFont.load_default()


def original_wallpaper():
    keep = os.path.join(DATA, 'original_wallpaper')
    if os.path.exists(keep + '.path'):
        return open(keep + '.path', encoding='utf-8').read().strip()
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Control Panel\Desktop') as k:
        cur = winreg.QueryValueEx(k, 'WallPaper')[0]
    if cur and os.path.exists(cur) and 'Crunch' not in cur:
        ext = os.path.splitext(cur)[1] or '.jpg'
        shutil.copyfile(cur, keep + ext)
        cur = keep + ext
    open(keep + '.path', 'w', encoding='utf-8').write(cur or '')
    return cur


def draw_wallpaper(data, now, out_path=None):
    from PIL import Image, ImageDraw
    user32 = ctypes.windll.user32
    W, H = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
    base = original_wallpaper()
    try:
        img = Image.open(base).convert('RGB')
        r = max(W / img.width, H / img.height)
        img = img.resize((int(img.width * r) + 1, int(img.height * r) + 1)).crop((0, 0, W, H))
    except Exception:
        img = Image.new('RGB', (W, H), (0, 0, 0))
    # dark veil on the left so the red countdown pops clearly
    veil = Image.new('L', (W, H), 0)
    vd = ImageDraw.Draw(veil)
    for x in range(int(W * 0.72)):
        vd.line([(x, 0), (x, H)], fill=int(240 * (1 - x / (W * 0.72)) ** 1.15))
    img = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), img, veil)
    d = ImageDraw.Draw(img)
    st = data['settings']
    work_h, clock_h, today_left_s = hours_left(now, st)
    today = now.date().isoformat()
    step = next((s for s in data['steps'] if s['start'] <= today <= s['end']), None)
    y_day = data['days'].get((now.date() - timedelta(days=1)).isoformat(), {})
    s = H / 1080
    x0, y0 = int(90 * s), int(H * 0.24)

    # Big Red Real-Time Waking Countdown Today (excluding sleep)
    th = today_left_s // 3600
    tm = (today_left_s // 60) % 60
    today_str = f'{th:02d}:{tm:02d}'
    big = font(int(210 * s))
    RED_RGB = (255, 69, 58)
    d.text((x0, y0), today_str, font=big, fill=RED_RGB)
    bw = d.textlength(today_str, font=big)
    d.text((x0 + bw + 18 * s, y0 + 115 * s), 'left today', font=font(int(58 * s)), fill=RED_RGB)
    d.text((x0 + 6 * s, y0 + 235 * s), f'until sleep ({st.get("bed", "23:00")}) · wake {st.get("wake", "07:00")}',
           font=font(int(30 * s), False), fill=(210, 210, 215))

    # Sleep-adjusted total waking hours left to release in red
    y_rel = y0 + 300 * s
    rel_big = font(int(96 * s))
    work_str = f'{int(round(work_h))} h'
    d.text((x0 + 6 * s, y_rel), work_str, font=rel_big, fill=RED_RGB)
    rw = d.textlength(work_str, font=rel_big)
    d.text((x0 + 6 * s + rw + 16 * s, y_rel + 38 * s),
           f'waking hours to release (sleep subtracted · {int(clock_h // 24)}d {int(clock_h % 24)}h calendar)',
           font=font(int(28 * s), False), fill=(200, 200, 205))

    yy = y_rel + 135 * s
    if step:
        d.text((x0 + 6 * s, yy), f'TODAY · STEP {step["n"]}', font=font(int(24 * s)), fill=(255, 159, 10))
        d.text((x0 + 6 * s, yy + 34 * s), step['title'], font=font(int(54 * s)), fill=(255, 255, 255))
        yy += 116 * s
    if pct(y_day):
        d.text((x0 + 6 * s, yy), f'Yesterday: {pct(y_day)}  ·  streak {streak(data["days"], today)}',
               font=font(int(30 * s), False), fill=(200, 200, 205))
    out = out_path or os.path.join(DATA, 'wallpaper.png')
    img.save(out)
    if not out_path:
        ctypes.windll.user32.SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, out, 3)
    return out


def restore_wallpaper():
    p = original_wallpaper()
    if p:
        ctypes.windll.user32.SystemParametersInfoW(SPI_SETDESKWALLPAPER, 0, p, 3)


# ---------------------------------------------------------------- capsule (Speedrun Timer Island)
class Capsule:
    H = 54

    def __init__(self):
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', True)
        self.root.configure(bg=KEY)
        self.root.wm_attributes('-transparentcolor', KEY)
        self.canvas = tk.Canvas(self.root, height=self.H, bg=KEY, highlightthickness=0, bd=0)
        self.canvas.pack(fill='both', expand=True)
        self.big_fnt = ('Consolas', 26, 'bold')
        self.fnt = ('Segoe UI Variable Text Semibold', 12)
        self.data = None
        self.err = None
        self.expanded = False  # False = pure speedrun number only; True = shows details alongside number
        self.wall_on = not os.path.exists(os.path.join(DATA, 'no_wallpaper'))
        self.cloud = None if DEMO else Cloud()
        pos = self._load_pos()
        self.root.geometry(f'+{pos[0]}+{pos[1]}')
        for ev, fn in (('<ButtonPress-1>', self._press), ('<B1-Motion>', self._drag), ('<ButtonRelease-1>', self._release),
                       ('<Double-Button-1>', lambda _e: self.open_app()), ('<Button-3>', self._menu)):
            self.canvas.bind(ev, fn)
        self.menu = tk.Menu(self.root, tearoff=0)
        self.menu.add_command(label='Done', command=lambda: self.act('done'))
        self.menu.add_command(label='Extend +15 min', command=lambda: self.act('extend15'))
        self.menu.add_command(label='Pause task', command=lambda: self.act('pause'))
        self.menu.add_command(label='Start next', command=lambda: self.act('next'))
        self.menu.add_separator()
        self.menu.add_command(label='Pause idle alerts (1h Nap/Class)', command=lambda: self.act('snooze60'))
        self.menu.add_command(label='Resume idle alerts', command=lambda: self.act('unsnooze'))
        self.menu.add_separator()
        self.menu.add_command(label='Show / Hide Details', command=self.toggle_details)
        self.menu.add_command(label='Open Crunch (PC View)', command=self.open_app)
        self.menu.add_command(label='Refresh', command=lambda: threading.Thread(target=self.fetch, daemon=True).start())
        self.menu.add_command(label='Wallpaper on/off', command=self.toggle_wall)
        self.menu.add_separator()
        self.menu.add_command(label='Quit', command=self.quit)

    def _load_pos(self):
        try:
            return json.load(open(os.path.join(DATA, 'pos.json')))
        except Exception:
            return [self.root.winfo_screenwidth() // 2 - 90, 10]

    def _press(self, e):
        self._start = (e.x_root, e.y_root, self.root.winfo_x(), self.root.winfo_y())
        self._moved = False

    def _drag(self, e):
        sx, sy, wx, wy = self._start
        if abs(e.x_root - sx) + abs(e.y_root - sy) > 3:
            self._moved = True
        self.root.geometry(f'+{wx + e.x_root - sx}+{wy + e.y_root - sy}')

    def _release(self, _e):
        if self._moved:
            json.dump([self.root.winfo_x(), self.root.winfo_y()], open(os.path.join(DATA, 'pos.json'), 'w'))
        else:
            self.toggle_details()

    def toggle_details(self):
        self.expanded = not self.expanded
        self.draw_now()

    def _menu(self, e):
        self.menu.tk_popup(e.x_root, e.y_root)

    def open_app(self):
        url = CFG['appUrl'] + ('?demo=1' if DEMO else '')
        exe = BRAVE if os.path.exists(BRAVE) else None
        if exe:
            subprocess.Popen([exe, f'--app={url}', '--window-size=1240,840'])
        else:
            os.startfile(url)

    def toggle_wall(self):
        self.wall_on = not self.wall_on
        flag = os.path.join(DATA, 'no_wallpaper')
        if self.wall_on:
            if os.path.exists(flag):
                os.remove(flag)
            self.update_wall()
        else:
            open(flag, 'w').close()
            restore_wallpaper()

    def act(self, what):
        if DEMO or not self.data:
            return
        now = datetime.now()
        stamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        today = now.date().isoformat()
        blocks = self.data['blocks']
        run = next((b for b in blocks if b.get('runningSince')), None)
        changes = []
        st_patch = None

        if what == 'extend15' and run:
            act_m = int(round(actual_ms(run, now) / 60000))
            nb = dict(run, expectedMin=max(run.get('expectedMin', 30), act_m) + 15)
            changes.append(nb)
        elif what == 'snooze60':
            until = (datetime.now(timezone.utc) + timedelta(minutes=60)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            st_patch = dict(self.data['settings'], idleSnoozeUntil=until, idleSnoozeReason='1h Nap/Class')
        elif what == 'unsnooze':
            st_patch = dict(self.data['settings'], idleSnoozeUntil=None, idleSnoozeReason=None)
        elif run and what in ('done', 'pause', 'next'):
            nb = dict(run, actualMs=actual_ms(run, now), runningSince=None)
            nb['doneAt' if what == 'done' else 'pausedAt'] = stamp
            changes.append(nb)
        if what == 'next':
            todo = [b for b in blocks if b.get('date') == today and b.get('kind') == 'task' and not b.get('doneAt')
                    and not b.get('runningSince') and (not run or b['id'] != run['id'])]
            todo.sort(key=lambda b: b.get('plannedStart') or '99:99')
            if todo:
                changes.append(dict(todo[0], runningSince=stamp, doneAt=None))

        def go():
            try:
                for b in changes:
                    self.cloud.save_block(b)
                if st_patch is not None:
                    self.cloud.save_settings(st_patch)
            except Exception:
                self.err = 'Sync error'
            self.fetch()
        threading.Thread(target=go, daemon=True).start()

    def quit(self):
        self.root.destroy()

    def fetch(self):
        try:
            self.data = demo_data() if DEMO else self.cloud.load()
            self.err = None
        except urllib.error.HTTPError as e:
            self.err = f'Sync error {e.code}'
        except Exception:
            self.err = 'Offline'

    def poll(self):
        threading.Thread(target=self.fetch, daemon=True).start()
        self.root.after(15000, self.poll)

    def update_wall(self):
        if self.wall_on and self.data and not DEMO:
            threading.Thread(target=draw_wallpaper, args=(self.data, datetime.now()), daemon=True).start()

    def wall_loop(self):
        self.update_wall()
        self.root.after(60000, self.wall_loop)

    def draw_now(self):
        c = self.canvas
        c.delete('all')
        if self.data:
            big_num, big_col, segs, outline = status(self.data, datetime.now())
        else:
            big_num, big_col, segs, outline = '--:--', WHITE, [('Loading…', GREY)], None
        if self.err and self.data:
            segs.append((self.err, GREY))

        import tkinter.font as tkf
        bf = tkf.Font(family=self.big_fnt[0], size=self.big_fnt[1], weight='bold')
        sf = tkf.Font(family=self.fnt[0], size=self.fnt[1])
        pad, gap = 20, 12
        big_w = bf.measure(big_num)

        if not self.expanded:
            # Speedrun mode: ONLY the fat number, zero extra text
            W = pad * 2 + big_w
            self.root.geometry(f'{W}x{self.H}')
            c.config(width=W)
            r = self.H // 2
            fill = '#0f0f12'
            col = outline or '#242428'
            c.create_oval(0, 0, self.H, self.H, fill=col, outline=col)
            c.create_oval(W - self.H, 0, W, self.H, fill=col, outline=col)
            c.create_rectangle(r, 0, W - r, self.H, fill=col, outline=col)
            c.create_oval(2, 2, self.H - 2, self.H - 2, fill=fill, outline=fill)
            c.create_oval(W - self.H + 2, 2, W - 2, self.H - 2, fill=fill, outline=fill)
            c.create_rectangle(r, 2, W - r, self.H - 2, fill=fill, outline=fill)
            c.create_text(W // 2, r, text=big_num, fill=big_col, font=self.big_fnt, anchor='center')
            return

        # Expanded mode (when clicked): fat number + details
        widths = [sf.measure(t) for t, _ in segs]
        W = pad * 2 + big_w + gap * 2 + sum(widths) + (gap * 2 + 3) * max(0, len(segs) - 1)
        self.root.geometry(f'{W}x{self.H}')
        c.config(width=W)
        r = self.H // 2
        fill = '#141418'
        col = outline or '#2c2c30'
        c.create_oval(0, 0, self.H, self.H, fill=col, outline=col)
        c.create_oval(W - self.H, 0, W, self.H, fill=col, outline=col)
        c.create_rectangle(r, 0, W - r, self.H, fill=col, outline=col)
        c.create_oval(2, 2, self.H - 2, self.H - 2, fill=fill, outline=fill)
        c.create_oval(W - self.H + 2, 2, W - 2, self.H - 2, fill=fill, outline=fill)
        c.create_rectangle(r, 2, W - r, self.H - 2, fill=fill, outline=fill)
        x = pad
        c.create_text(x, r, text=big_num, fill=big_col, font=self.big_fnt, anchor='w')
        x += big_w + gap * 2
        for i, ((t, colr), w) in enumerate(zip(segs, widths)):
            c.create_text(x, r, text=t, fill=colr, font=self.fnt, anchor='w')
            x += w
            if i < len(segs) - 1:
                c.create_oval(x + gap, r - 2, x + gap + 4, r + 2, fill='#636366', outline='#636366')
                x += gap * 2 + 4

    def draw(self):
        self.draw_now()
        self.root.after(1000, self.draw)

    def run(self):
        self.fetch()
        self.poll()
        self.draw()
        self.root.after(2000, self.wall_loop)
        self.root.mainloop()


if __name__ == '__main__':
    if '--wallpaper-test' in sys.argv:
        print(draw_wallpaper(demo_data(), datetime.now(), out_path=sys.argv[-1]))
    elif '--restore-wallpaper' in sys.argv:
        restore_wallpaper()
    else:
        Capsule().run()
