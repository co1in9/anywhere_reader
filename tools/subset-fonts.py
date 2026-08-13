#!/usr/bin/env python3
"""Regenerate the bundled PingFang SC webfonts in `src/assets/fonts/`.

Source: https://github.com/ShmilyHTT/PingFang (PingFang-Regular.ttf / PingFang-Bold.ttf,
~11 MB each). The full font covers ~30k codepoints; it is subset to the GB2312
character set (6763 hanzi + ASCII + CJK punctuation) so each weight compresses
to well under 1 MB, which keeps the lazy download acceptable on mobile.

Usage:
    pip install fonttools brotli
    python tools/subset-fonts.py /path/to/PingFang
"""
import subprocess
import sys
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "src" / "assets" / "fonts"
WEIGHTS = ("Regular", "Bold")


def gb2312_charset() -> str:
    chars = {chr(c) for c in range(0x20, 0x7F)}
    for b1 in range(0xA1, 0xF8):
        for b2 in range(0xA1, 0xFF):
            try:
                chars.add(bytes([b1, b2]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return "".join(sorted(chars))


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    src = Path(sys.argv[1])
    charset = OUT_DIR / "charset.txt"
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    charset.write_text(gb2312_charset(), encoding="utf-8")
    try:
        for weight in WEIGHTS:
            subprocess.run(
                [
                    "pyftsubset",
                    str(src / f"PingFang-{weight}.ttf"),
                    f"--text-file={charset}",
                    f"--output-file={OUT_DIR / f'PingFangSC-{weight}.subset.woff2'}",
                    "--flavor=woff2",
                    "--layout-features=",
                    "--no-hinting",
                    "--desubroutinize",
                ],
                check=True,
            )
    finally:
        charset.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
