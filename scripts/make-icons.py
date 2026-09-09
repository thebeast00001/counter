"""
Draws the app icon, so the mark has a source rather than only a binary.

    python scripts/make-icons.py

The mark is a tally: four uprights crossed by a fifth stroke. It is what a
shopkeeper actually does on the back of a notebook to count a day, which is the
thing this app replaces — and unlike a bar chart or a rupee glyph it says
"counting" without saying "finance app". The name is the other half of the joke:
a counter is where the business happens and also what does the counting.

Black ground with the app's own indigo, because that is exactly what the app
looks like. On a home screen of white and gradient tiles a black one is the
distinctive choice, not the timid one.

Everything is drawn at 4x and downsampled, because PIL has no antialiasing of
its own and a 1px-aliased stroke at 1024 is visible at 48.
"""

from PIL import Image, ImageDraw

OUT = "assets/images/"

SIZE = 1024
SS = 4  # supersample factor

GROUND = (10, 10, 12, 255)  # the app's near-black, not pure #000
MARK = (127, 166, 255, 255)  # ACCENTS.indigo.dark — the one accent

# Four uprights and the stroke through them.
BARS = 4
BAR_W = 62
BAR_GAP = 52
BAR_H = 290

# How far the diagonal overhangs the outer uprights at each end, and how much of
# the uprights' height it climbs. Kept below `BAR_H` on purpose: a fifth stroke
# that rises past the top of the four reads as a slash drawn over them rather
# than as part of the same tally.
CROSS_OVER = 34
CROSS_RISE = 232
CROSS_W = 58


def rounded_bar(draw, cx, cy, w, h, colour):
    """A vertical stroke with round caps, centred on (cx, cy)."""
    draw.rounded_rectangle(
        [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
        radius=w / 2,
        fill=colour,
    )


def tally(size, scale=1.0, colour=MARK):
    """The mark alone, on transparency, centred in a `size` square."""
    big = size * SS
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    k = (big / SIZE) * scale
    mid = big / 2

    width = BARS * BAR_W + (BARS - 1) * BAR_GAP
    first = mid - (width * k) / 2 + (BAR_W * k) / 2

    for i in range(BARS):
        rounded_bar(draw, first + i * (BAR_W + BAR_GAP) * k, mid, BAR_W * k, BAR_H * k, colour)

    """
    The diagonal is drawn flat and rotated, rather than as a polygon.

    A rotated rounded rectangle keeps its round caps; four points rotated by
    hand do not, and the mismatch between square caps here and round caps on the
    uprights is the kind of thing that looks wrong without being nameable.
    """
    span = (width + CROSS_OVER * 2) * k
    rise = CROSS_RISE * k
    length = (span**2 + rise**2) ** 0.5

    bar = Image.new("RGBA", (int(length), int(CROSS_W * k)), (0, 0, 0, 0))
    ImageDraw.Draw(bar).rounded_rectangle(
        [0, 0, length - 1, CROSS_W * k - 1], radius=CROSS_W * k / 2, fill=colour
    )
    import math

    angle = math.degrees(math.atan2(rise, span))
    bar = bar.rotate(angle, expand=True, resample=Image.BICUBIC)

    img.alpha_composite(bar, (int(mid - bar.width / 2), int(mid - bar.height / 2)))
    return img.resize((size, size), Image.LANCZOS)


def write(name, img):
    img.save(OUT + name)
    print(f"  {name:36} {img.size[0]}x{img.size[1]}")


print("writing icons")

# Adaptive icon: two layers Android composites and masks itself. The foreground
# must sit inside the central 66%, so the mark is drawn smaller here than on the
# square icon, which nothing crops.
write("android-icon-background.png", Image.new("RGBA", (SIZE, SIZE), GROUND))
write("android-icon-foreground.png", tally(SIZE, scale=1.10))

# Themed icons take alpha only; the colour is supplied by the launcher.
write("android-icon-monochrome.png", tally(SIZE, scale=1.10, colour=(255, 255, 255, 255)))

# The square icon, composited, for everywhere that does not do layers.
square = Image.new("RGBA", (SIZE, SIZE), GROUND)
square.alpha_composite(tally(SIZE, scale=1.18))
write("icon.png", square)

# The splash draws on `backgroundColor` from app.json, so it wants the mark alone.
write("splash-icon.png", tally(512, scale=1.3))

write("favicon.png", square.resize((96, 96), Image.LANCZOS))

print("done")
