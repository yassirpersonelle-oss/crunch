import sys, glob, os
from PIL import Image
d = sys.argv[1]; per = int(sys.argv[2]) if len(sys.argv) > 2 else 4
files = sorted(glob.glob(os.path.join(d, '[0-9]*.png')))
os.makedirs(os.path.join(d, 'sheets'), exist_ok=True)
for i in range(0, len(files), per):
    ims = [Image.open(f).resize((414, 896)) for f in files[i:i+per]]
    sheet = Image.new('RGB', (len(ims) * 424, 896), (60, 60, 60))
    for k, im in enumerate(ims): sheet.paste(im, (k * 424, 0))
    sheet.save(os.path.join(d, 'sheets', f'sheet{i//per+1}.png'))
print(len(files))
