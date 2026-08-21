#!/usr/bin/env python3
"""Render the PWA icons in public/ from their SVG sources.

Requires cairosvg:  pip install cairosvg
"""
from pathlib import Path

import cairosvg

PUBLIC = Path(__file__).resolve().parent.parent / "public"

TARGETS = [
    ("icon.svg", "pwa-192.png", 192),
    ("icon.svg", "pwa-512.png", 512),
    ("icon-maskable.svg", "pwa-maskable-512.png", 512),
    ("icon-maskable.svg", "apple-touch-icon.png", 180),
]


def main() -> None:
    for source, output, size in TARGETS:
        cairosvg.svg2png(
            url=str(PUBLIC / source),
            write_to=str(PUBLIC / output),
            output_width=size,
            output_height=size,
        )
        print(f"{source} -> {output} ({size}x{size})")


if __name__ == "__main__":
    main()
