import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
S = 1024
img = Image.new('RGB', (S, S))
d = ImageDraw.Draw(img)
# vertical gradient: iOS system orange -> slightly deeper
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=(int(255 - 10 * t), int(170 - 40 * t), int(20 - 10 * t)))
W = (255, 255, 255)
cx, top, bot, w, neck = S // 2, 230, 794, 400, 34
d.rounded_rectangle([cx - w // 2 - 20, top - 40, cx + w // 2 + 20, top + 6], 22, fill=W)
d.rounded_rectangle([cx - w // 2 - 20, bot - 6, cx + w // 2 + 20, bot + 40], 22, fill=W)
mid = (top + bot) // 2
# glass outline (thick) as two triangles
t = 34
d.polygon([(cx - w // 2, top), (cx + w // 2, top), (cx + neck, mid), (cx - neck, mid)], fill=W)
d.polygon([(cx - w // 2 + t * 1.6, top + t), (cx + w // 2 - t * 1.6, top + t), (cx + neck - 8, mid - t * .6), (cx - neck + 8, mid - t * .6)], fill=(250, 150, 18))
d.polygon([(cx - neck, mid), (cx + neck, mid), (cx + w // 2, bot), (cx - w // 2, bot)], fill=W)
d.polygon([(cx - neck + 8, mid + t * .6), (cx + neck - 8, mid + t * .6), (cx + w // 2 - t * 1.6, bot - t), (cx - w // 2 + t * 1.6, bot - t)], fill=(248, 140, 16))
# sand: small top pile + bottom heap
d.polygon([(cx - 120, top + 150), (cx + 120, top + 150), (cx + 14, mid - 30), (cx - 14, mid - 30)], fill=W)
d.polygon([(cx - 6, mid + 20), (cx + 6, mid + 20), (cx + 150, bot - t - 2), (cx - 150, bot - t - 2)], fill=W)
for size in (180, 192, 512):
    img.resize((size, size), Image.LANCZOS).save(f'{out}/icon-{size}.png')
print('ok')
