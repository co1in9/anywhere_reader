#!/usr/bin/env python3
"""Generate all app icons from public/logo-transparent.png (requires Pillow)."""
from pathlib import Path

from PIL import Image

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


def main() -> None:
    with Image.open(PUBLIC / "logo-transparent.png") as source:
        source = source.convert("RGBA")
        bounds = source.getchannel("A").point(lambda a: 255 if a > 128 else 0).getbbox()
        if bounds is None:
            raise ValueError("Logo source contains no visible artwork")
        artwork = source.crop(bounds)
        for output, size, fill, opaque in TARGETS:
            mark = artwork.copy()
            mark.thumbnail((round(size * fill), round(size * fill)), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (size, size), "white" if opaque else (0, 0, 0, 0))
            canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
            if opaque:
                canvas = canvas.convert("RGB")
            canvas.save(output)
            print(f"{output.relative_to(ROOT)} ({size}x{size})")


if __name__ == "__main__":
    main()
