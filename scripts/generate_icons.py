#!/usr/bin/env python3
"""生成应用图标（PNG / ICO / 托盘图标）。

只在需要修改图标时运行：
    python3 scripts/generate_icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

SIZE = 1024
MARGIN = 36
RADIUS = 232

TOP_COLOR = (129, 140, 248)     # indigo 400
BOTTOM_COLOR = (79, 70, 229)    # indigo 600

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/msyhbd.ttc",
]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, margin, radius):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (margin, margin, size - margin, size - margin),
        radius=radius,
        fill=255,
    )
    return mask


def base_icon():
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # 垂直渐变
    gradient = Image.new("RGB", (SIZE, SIZE))
    pixels = gradient.load()
    inner = SIZE - MARGIN * 2
    for y in range(SIZE):
        t = min(1.0, max(0.0, (y - MARGIN) / inner))
        color = lerp(TOP_COLOR, BOTTOM_COLOR, t)
        for x in range(SIZE):
            pixels[x, y] = color

    # 左上柔光
    glow = Image.new("L", (SIZE, SIZE), 0)
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((90, 40, 700, 560), fill=80)
    glow = glow.filter(ImageFilter.GaussianBlur(140))
    light = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 0))
    light.putalpha(glow)
    gradient = Image.alpha_composite(gradient.convert("RGBA"), light).convert("RGB")

    canvas.paste(gradient, (0, 0), rounded_mask(SIZE, MARGIN, RADIUS))

    # 内描边
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (MARGIN + 8, MARGIN + 8, SIZE - MARGIN - 8, SIZE - MARGIN - 8),
        radius=RADIUS - 8,
        outline=(255, 255, 255, 46),
        width=5,
    )

    # ¥ 字符
    font = None
    for path in FONT_CANDIDATES:
        try:
            candidate = ImageFont.truetype(path, 520)
            if candidate.getbbox("¥"):
                font = candidate
                break
        except OSError:
            continue
    if font is None:
        font = ImageFont.load_default()

    text_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    text_draw = ImageDraw.Draw(text_layer)
    bbox = text_draw.textbbox((0, 0), "¥", font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    tx = (SIZE - text_w) / 2 - bbox[0]
    ty = (SIZE - text_h) / 2 - bbox[1] - 18

    # 阴影
    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.text((tx, ty + 14), "¥", font=font, fill=(30, 27, 75, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(20))
    canvas = Image.alpha_composite(canvas, shadow)

    text_draw.text((tx, ty), "¥", font=font, fill=(255, 255, 255, 255))
    canvas = Image.alpha_composite(canvas, text_layer)
    return canvas


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    icon = base_icon()

    icon.resize((512, 512), Image.Resampling.LANCZOS).save(BUILD / "icon.png")
    icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(BUILD / "icon-1024.png")

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon.save(BUILD / "icon.ico", format="ICO", sizes=ico_sizes)

    tray = icon.resize((64, 64), Image.Resampling.LANCZOS)
    tray.save(BUILD / "tray.png")
    tray.resize((32, 32), Image.Resampling.LANCZOS).save(BUILD / "tray-32.png")

    print("icons written to", BUILD)


if __name__ == "__main__":
    main()
