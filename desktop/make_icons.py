"""App icon (an original design: a note over chord bars) as PNG, ICO and ICNS. Usage: make_icons.py OUT_DIR"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
# diagonal gradient pink -> violet in a rounded square
grad = Image.new("RGBA", (S, S))
px = grad.load()
a, b = (255, 79, 123), (124, 92, 255)
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * S)
        px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((40, 40, S - 40, S - 40), radius=220, fill=255)
img.paste(grad, (0, 0), mask)
ov = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(ov)
W = (255, 255, 255, 255)
# three chord bars along the bottom (translucent)
for i, h in enumerate((90, 150, 120)):
    x0 = 250 + i * 190
    d.rounded_rectangle((x0, 860 - h, x0 + 140, 860), radius=26, fill=(255, 255, 255, 120))
img = Image.alpha_composite(img, ov)
d = ImageDraw.Draw(img)
# an eighth note above them
d.ellipse((330, 470, 530, 630), fill=W)
d.rectangle((482, 170, 530, 560), fill=W)
d.polygon([(530, 170), (730, 240), (730, 340), (530, 270)], fill=W)

img.resize((512, 512), Image.LANCZOS).save(out / "lyricord.png")
img.save(out / "lyricord.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.save(out / "lyricord.icns")
print("icons in", out)
