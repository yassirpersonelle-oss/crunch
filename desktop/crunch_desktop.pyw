"""Crunch for Windows: an always-on-top draggable capsule + a live countdown wallpaper.

One light process (tkinter + Pillow). Reads the same Supabase data as the phone app.
Click the capsule -> opens the full app in a phone-sized window. Right-click -> menu.
Run:  pythonw crunch_desktop.pyw          (first run asks for your email + the 6-digit code)
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
from datetime import datetime, timedelta
import tkinter as tk
from tkinter import simpledialog

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.environ.get('APPDATA', HERE), 'Crunch')
os.makedirs(DATA, exist_ok=True)
CFG = json.load(open(os.path.join(HERE, 'config.json'), encoding='utf-8'))
DEMO = '--demo' in sys.argv
BRAVE = r'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'

ORANGE, RED, GREEN, GREY, WHITE = '#ff9f0a', '#ff453a', '#30d158', '#8e8e93', '#ffffff'
KEY = '#010101'  # transparent colour of the capsule window


# ---------------------------------------------------------------- data
def hm(s):
    h, m = s.split(':')
    return int(h) * 60 + int(m)


def iso(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone().replace(tzinfo=None) if s else None


class Cloud:
    def __init__(self):
        self.session_file = os.path.join(DATA, 'session.json')
        self.session = json.load(open(self.session_file)) if os.path.exists(self.session_file) else None

    def _req(self, method, path, body=None, auth=True):
        url = CFG['supabaseUrl'] + path
        headers = {'apikey': CFG['supabaseKey'], 'Content-Type': 'application/json'}
        if auth and self.session:
            headers['Authorization'] = 'Bearer ' + self.session['access_token']
        req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read() or b'null')

    def _save(self, s):
        self.session = {'access_token': s['access_token'], 'refresh_token': s['refresh_token'], 'expires_at': time.time() + s['expires_in'] - 60}
        json.dump(self.session, open(self.session_file, 'w'))

    def login(self, ask):
        email = ask('Crunch', 'Your email (a 6-digit code will be sent):')
        if not email:
            return False
        self._req('POST', '/auth/v1/otp', {'email': email, 'create_user': False}, auth=False)
        code = ask('Crunch', f'Code sent to {email}:')
        if not code:
            return False
        self._save(self._req('POST', '/auth/v1/verify', {'type': 'email', 'email': email, 'token': code.strip()}, auth=False))
        return True

    def ensure(self):
        if self.session and time.time() > self.session['expires_at']:
            self._save(self._req('POST', '/auth/v1/token?grant_type=refresh_token', {'refresh_token': self.session['refresh_token']}, auth=False))

    def load(self):
        self.ensure()
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
        'days': {y: {'finishedAt': 'x', 'grade': 'B', 'bedAt': (now - timedelta(hours=14)).isoformat()},
                 t: {'upAt': (now - timedelta(hours=6)).isoformat()}},
        'blocks': [{'id': 'a', 'date': t, 'kind': 'task', 'title': 'Female walk set', 'expectedMin': 60,
                    'actualMs': 40 * 60000, 'runningSince': now.isoformat()}],
    }


# ---------------------------------------------------------------- maths (mirrors app/js/logic.js)
def hours_left(now, st):
    release = datetime.fromisoformat(st['releaseAt'])
    work = 0.0
    d = now.date()
    while d <= release.date():
        a = max(datetime.combine(d, datetime.min.time()) + timedelta(minutes=hm(st['wake'])), now)
        b = min(datetime.combine(d, datetime.min.time()) + timedelta(minutes=hm(st['bed'])), release)
        if b > a:
            work += (b - a).total_seconds()
        d += timedelta(days=1)
    return work / 3600, max(0, (release - now).total_seconds()) / 3600


def actual_ms(b, now):
    run = iso(b.get('runningSince'))
    return (b.get('actualMs') or 0) + ((now - run).total_seconds() * 1000 if run else 0)


def streak(days, today):
    k = today if days.get(today, {}).get('finishedAt') else (datetime.fromisoformat(today) - timedelta(days=1)).date().isoformat()
    n = 0
    while days.get(k, {}).get('finishedAt') and days[k].get('grade') in ('A', 'B'):
        n += 1
        k = (datetime.fromisoformat(k) - timedelta(days=1)).date().isoformat()
    return n


def clock(ms):
    s = max(0, int(ms // 1000))
    m = s // 60
    return f'{m}:{s % 60:02d}' if m < 100 else f'{m // 60}:{m % 60:02d}:{s % 60:02d}'


def status(data, now):
    """What the capsule shows: list of (text, colour) segments + the outline colour."""
    st = data['settings']
    today = now.date().isoformat()
    day = data['days'].get(today, {})
    work_h, _ = hours_left(now, st)
    segs = [(f'{int(work_h)} h', WHITE)]
    run = next((b for b in data['blocks'] if b.get('runningSince')), None)
    mins = now.hour * 60 + now.minute
    if day.get('bedAt') or (not day.get('upAt') and mins < hm(st['wake'])):
        segs.append(('Sleeping', GREY))
    elif day.get('finishedAt'):
        segs.append((f'Day done · {day.get("grade", "")}', GREY))
    elif run:
        act, exp = actual_ms(run, now), run['expectedMin'] * 60000
        col = RED if act > exp else (GREEN if run.get('kind') == 'gym' else ORANGE)
        title = run['title'] if len(run['title']) <= 22 else run['title'][:21] + '…'
        segs.append((title, WHITE))
        segs.append((f'{clock(act)} / {clock(exp)}', col))
    else:
        marks = [iso(day.get('upAt'))] + [iso(b.get(k)) for b in data['blocks'] for k in ('doneAt', 'pausedAt')]
        marks = [m for m in marks if m]
        idle = (now - max(marks)).total_seconds() / 60 if marks else 0
        segs.append((f'Idle {int(idle)} min' if idle >= 5 else 'Nothing running', RED if idle >= 5 else GREY))
    segs.append((f'🔥 {streak(data["days"], today)}', ORANGE))
    outline = None
    if not day.get('finishedAt'):
        if mins >= hm(st['bed']):
            outline = RED
        elif mins >= hm(st['bed']) - 30:
            outline = ORANGE
    return segs, outline


# ---------------------------------------------------------------- wallpaper
SPI_SETDESKWALLPAPER = 20


def font(size, bold=True):
    from PIL import ImageFont
    for name in (('seguibl.ttf' if bold else 'segoeui.ttf'), 'segoeuib.ttf', 'arialbd.ttf'):
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
    # dark veil on the left so the numbers always read
    veil = Image.new('L', (W, H), 0)
    vd = ImageDraw.Draw(veil)
    for x in range(int(W * 0.68)):
        vd.line([(x, 0), (x, H)], fill=int(235 * (1 - x / (W * 0.68)) ** 1.15))
    img = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), img, veil)
    d = ImageDraw.Draw(img)
    st = data['settings']
    work_h, clock_h = hours_left(now, st)
    today = now.date().isoformat()
    step = next((s for s in data['steps'] if s['start'] <= today <= s['end']), None)
    y_day = data['days'].get((now.date() - timedelta(days=1)).isoformat(), {})
    s = H / 1080
    x0, y0 = int(90 * s), int(H * 0.30)
    big = font(int(220 * s))
    d.text((x0, y0), f'{int(work_h)}', font=big, fill=(255, 255, 255))
    bw = d.textlength(f'{int(work_h)}', font=big)
    d.text((x0 + bw + 14 * s, y0 + 120 * s), 'h', font=font(int(90 * s)), fill=(150, 150, 155))
    d.text((x0 + 6 * s, y0 + 260 * s), 'work hours to release', font=font(int(34 * s), False), fill=(200, 200, 205))
    d.text((x0 + 6 * s, y0 + 310 * s), f'{int(clock_h // 24)} days {int(clock_h % 24)} h on the clock · Sat 14 Nov 18:00',
           font=font(int(26 * s), False), fill=(150, 150, 155))
    yy = y0 + 390 * s
    if step:
        d.text((x0 + 6 * s, yy), f'TODAY · STEP {step["n"]}', font=font(int(24 * s)), fill=(255, 159, 10))
        d.text((x0 + 6 * s, yy + 34 * s), step['title'], font=font(int(56 * s)), fill=(255, 255, 255))
        yy += 120 * s
    if y_day.get('grade'):
        d.text((x0 + 6 * s, yy), f'Yesterday: {y_day["grade"]}  ·  streak {streak(data["days"], today)}',
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


# ---------------------------------------------------------------- capsule
class Capsule:
    H = 34

    def __init__(self):
        self.root = tk.Tk()
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', True)
        self.root.configure(bg=KEY)
        self.root.wm_attributes('-transparentcolor', KEY)
        self.canvas = tk.Canvas(self.root, height=self.H, bg=KEY, highlightthickness=0, bd=0)
        self.canvas.pack(fill='both', expand=True)
        self.fnt = ('Segoe UI Variable Text Semibold', 11)
        self.data = None
        self.err = None
        self.wall_on = not os.path.exists(os.path.join(DATA, 'no_wallpaper'))
        self.cloud = None if DEMO else Cloud()
        pos = self._load_pos()
        self.root.geometry(f'+{pos[0]}+{pos[1]}')
        for ev, fn in (('<ButtonPress-1>', self._press), ('<B1-Motion>', self._drag), ('<ButtonRelease-1>', self._release),
                       ('<Button-3>', self._menu)):
            self.canvas.bind(ev, fn)
        self.menu = tk.Menu(self.root, tearoff=0)
        self.menu.add_command(label='Open Crunch', command=self.open_app)
        self.menu.add_command(label='Refresh', command=lambda: threading.Thread(target=self.fetch, daemon=True).start())
        self.menu.add_command(label='Wallpaper on/off', command=self.toggle_wall)
        self.menu.add_separator()
        self.menu.add_command(label='Quit', command=self.quit)

    # position memory
    def _load_pos(self):
        try:
            return json.load(open(os.path.join(DATA, 'pos.json')))
        except Exception:
            return [self.root.winfo_screenwidth() // 2 - 200, 6]

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
            self.open_app()

    def _menu(self, e):
        self.menu.tk_popup(e.x_root, e.y_root)

    def open_app(self):
        url = CFG['appUrl'] + ('?demo=1' if DEMO else '')
        exe = BRAVE if os.path.exists(BRAVE) else None
        if exe:
            subprocess.Popen([exe, f'--app={url}', '--window-size=430,900'])
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

    def quit(self):
        self.root.destroy()

    # data
    def fetch(self):
        try:
            self.data = demo_data() if DEMO else self.cloud.load()
            self.err = None
        except urllib.error.HTTPError as e:
            self.err = f'Sync error {e.code}'
            if e.code == 401 and self.cloud:
                self.cloud.session = None
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
        self.root.after(5 * 60000, self.wall_loop)

    # drawing
    def draw(self):
        c = self.canvas
        c.delete('all')
        if self.data:
            segs, outline = status(self.data, datetime.now())
        else:
            segs, outline = [('Crunch', WHITE), (self.err or 'Loading…', GREY)], None
        if self.err and self.data:
            segs.append((self.err, GREY))
        import tkinter.font as tkf
        f = tkf.Font(family=self.fnt[0], size=self.fnt[1])
        pad, gap = 16, 10
        widths = [f.measure(t) for t, _ in segs]
        W = pad * 2 + sum(widths) + (gap * 2 + 3) * (len(segs) - 1)
        self.root.geometry(f'{W}x{self.H}')
        c.config(width=W)
        r = self.H // 2
        fill = '#1c1c1e'
        col = outline or fill
        c.create_oval(0, 0, self.H, self.H, fill=col, outline=col)
        c.create_oval(W - self.H, 0, W, self.H, fill=col, outline=col)
        c.create_rectangle(r, 0, W - r, self.H, fill=col, outline=col)
        if outline:  # inner fill to leave a 2px coloured ring
            c.create_oval(2, 2, self.H - 2, self.H - 2, fill=fill, outline=fill)
            c.create_oval(W - self.H + 2, 2, W - 2, self.H - 2, fill=fill, outline=fill)
            c.create_rectangle(r, 2, W - r, self.H - 2, fill=fill, outline=fill)
        x = pad
        for i, ((t, colr), w) in enumerate(zip(segs, widths)):
            c.create_text(x, r, text=t, fill=colr, font=self.fnt, anchor='w')
            x += w
            if i < len(segs) - 1:
                c.create_oval(x + gap, r - 1.5, x + gap + 3, r + 1.5, fill='#636366', outline='#636366')
                x += gap * 2 + 3
        self.root.after(1000, self.draw)

    def run(self):
        if self.cloud and not self.cloud.session:
            ok = self.cloud.login(lambda t, p: simpledialog.askstring(t, p, parent=self.root))
            if not ok:
                self.root.destroy()
                return
        self.fetch()
        self.poll()
        self.draw()
        self.root.after(3000, self.wall_loop)
        self.root.mainloop()


if __name__ == '__main__':
    if '--wallpaper-test' in sys.argv:
        print(draw_wallpaper(demo_data(), datetime.now(), out_path=sys.argv[-1]))
    elif '--restore-wallpaper' in sys.argv:
        restore_wallpaper()
    else:
        Capsule().run()
