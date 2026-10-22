#!/usr/bin/env python3
"""Generate all app icons (web + Android) from public/logo-transparent.png (requires Pillow)."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
# Opaque artwork defines the crop, excluding faint extraction artifacts far away.
TARGETS = [
    (PUBLIC / "favicon-32.png", 32, 0.94, False),
    (PUBLIC / "pwa-192.png", 192, 0.86, False),
    (PUBLIC / "pwa-512.png", 512, 0.86, False),
    (PUBLIC / "pwa-maskable-512.png", 512, 0.60, True),
    (PUBLIC / "apple-touch-icon.png", 180, 0.78, True),
    (ROOT / "src/assets/logo.png", 144, 0.94, False),
]
ANDROID_RES = ROOT / "android/app/src/main/res"
ANDROID_DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
# Android splash sizes per density (portrait), matching the Capacitor template.
ANDROID_SPLASH = {"mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280),
                  "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920)}


def render(artwork: Image.Image, size, fill: float, background) -> Image.Image:
    width, height = (size, size) if isinstance(size, int) else size
    mark = artwork.copy()
    edge = round(min(width, height) * fill)
    mark.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (width, height), background)
    canvas.alpha_composite(mark, ((width - mark.width) // 2, (height - mark.height) // 2))
    return canvas


def android_targets():
    """Launcher icons (legacy, round, adaptive foreground) and splash screens."""
    for name, scale in ANDROID_DENSITIES.items():
        mipmap = ANDROID_RES / f"mipmap-{name}"
        legacy = round(48 * scale)
        yield mipmap / "ic_launcher.png", legacy, 0.78, "white", None
        yield mipmap / "ic_launcher_round.png", legacy, 0.62, "white", "circle"
        # Adaptive icons are 108dp; only the central 66dp is guaranteed visible.
        yield mipmap / "ic_launcher_foreground.png", round(108 * scale), 0.50, (0, 0, 0, 0), None
        port = ANDROID_SPLASH[name]
        yield ANDROID_RES / f"drawable-port-{name}" / "splash.png", port, 0.36, "white", None
        land = port[::-1]
        yield ANDROID_RES / f"drawable-land-{name}" / "splash.png", land, 0.36, "white", None
    yield ANDROID_RES / "drawable" / "splash.png", (480, 320), 0.36, "white", None


def main() -> None:
    with Image.open(PUBLIC / "logo-transparent.png") as source:
        source = source.convert("RGBA")
        bounds = source.getchannel("A").point(lambda a: 255 if a > 128 else 0).getbbox()
        if bounds is None:
            raise ValueError("Logo source contains no visible artwork")
        artwork = source.crop(bounds)
        for output, size, fill, opaque in TARGETS:
            canvas = render(artwork, size, fill, "white" if opaque else (0, 0, 0, 0))
            if opaque:
                canvas = canvas.convert("RGB")
            canvas.save(output)
            print(f"{output.relative_to(ROOT)} ({size}x{size})")
        if not ANDROID_RES.is_dir():
            return
        for output, size, fill, background, mask in android_targets():
            canvas = render(artwork, size, fill, background)
            if mask == "circle":
                circle = Image.new("L", canvas.size, 0)
                ImageDraw.Draw(circle).ellipse((0, 0, canvas.width - 1, canvas.height - 1), fill=255)
                canvas.putalpha(circle)
            elif background == "white":
                canvas = canvas.convert("RGB")
            canvas.save(output)
            print(f"{output.relative_to(ROOT)} ({canvas.width}x{canvas.height})")


if __name__ == "__main__":
    main()
