import base64, io, os, sys
from PIL import Image
D = sys.argv[1]; OUT = sys.argv[2]
def b64(path, w=520, q=80):
    im = Image.open(path).convert('RGB')
    if im.width > w: im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=q, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
GROUPS = [
 ('Today', 'One big number, a half ring for the running task, round buttons, then only what is next.', [
   ('01-today', 'Today', 'Big work-hours number, today\'s time left, the late wake-up chip, the running task.'),
   ('02-today-over', 'Task over its time', 'Ring, timer and outline turn red; "+12 min over" appears.'),
   ('03-today-scrolled', 'Scrolled', 'Up next (3 tasks, See all for the rest), then three slim progress bars.'),
   ('04-celebrate', 'Done on time', 'The flame, a combo meter towards the blue flame, then your next task and Crunch the next task.'),
   ('05-overrun-toast', 'Done late', 'Same screen, quiet: grey flame, empty meter, no confetti. The next task is still one tap away.'),
   ('06-menu', 'Tap a task', 'iOS action sheet: Start, Edit, Delete.')]),
 ('Tasks & settings', 'Adding and editing tasks, routines, your day settings.', [
   ('07-new-task', 'New task', 'Title, kind, duration, optional time, fixed time, date, step.'),
   ('08-edit-task', 'Duration wheel', 'Tap a value and a wheel opens in place, like the Calendar app.'),
   ('13-settings', 'Settings', 'Wake/bed times, goals, routines you can drag, swipe and time.')]),
 ('Week, Plan, History', 'Planning ahead and looking back.', [
   ('09-week', 'Week planner', 'Hold a block to move it, drag its bottom edge to resize. Later tasks ripple, the gym stays put.'),
   ('10-plan', 'Plan', 'Countdown, one dot per day, then the steps as a timeline.'),
   ('11-history', 'History', 'One chart. Switch between Score, Work, Wasted and Sleep.')]),
 ('Morning', 'From waking up to starting the first task.', [
   ('14-morning', 'Up since?', 'Wheel set to now; shows how late you are vs 07:00.'),
   ('16-routine-timed', 'Routine card', 'One item per screen. Timed items count down and turn red when over.'),
   ('21-overview', 'Your day', 'Today\'s list, then one button to start the first task.')]),
 ('Evening', 'Finish the day, see the results, go to bed.', [
   ('17b-passed', 'Day passed', 'The ring fills while the score counts up, the grade pops in, confetti, then each stat ticks in.'),
   ('17-reveal', 'Day failed', 'A D or F day turns the ring and title red and the streak is lost.'),
   ('15-routine', 'Night routine', 'Tap the circle: it fills orange with a tick, then the next item slides in.'),
   ('19-tomorrow', 'Plan tomorrow', 'Unfinished tasks offered as one-tap carry-overs, then add new ones.'),
   ('20-night', 'Good night', 'Logs your bedtime and shows the sleep you will get.')]),
]
phones = []
for title, sub, items in GROUPS:
    cards = ''.join(f'''<figure class="shot"><img src="{b64(os.path.join(D, n + '.png'))}" alt="{t}" loading="lazy" width="414" height="896"><figcaption><b>{t}</b><span>{c}</span></figcaption></figure>''' for n, t, c in items)
    phones.append(f'<section><header><h2>{title}</h2><p>{sub}</p></header><div class="grid">{cards}</div></section>')
cap = b64(os.path.join(D, '..', 'capsule.png'), 1600, 85)
wall = b64(os.path.join(D, '..', 'wall.png'), 1280, 78)
flames = sys.argv[3] if len(sys.argv) > 3 else ''
html = open(os.path.join(os.path.dirname(__file__), 'review_template.html'), encoding='utf-8').read()
html = html.replace('{{SECTIONS}}', '\n'.join(phones)).replace('{{CAPSULE}}', cap).replace('{{WALL}}', wall).replace('{{FLAMES}}', open(flames, encoding='utf-8').read() if flames else '')
open(OUT, 'w', encoding='utf-8').write(html)
print(round(len(html) / 1e6, 2), 'MB')
