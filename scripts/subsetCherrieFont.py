#!/usr/bin/env python3
"""채리체(Griun Cherrie) 서체를 앱에서 쓰는 글자만 남겨 가볍게 만든다.

사용: python3 scripts/subsetCherrieFont.py
- 원본(전체 글자) TTF: src/assets/fonts/Griun_Cherrie-Rg.ttf
- 결과: src/assets/fonts/Griun_Cherrie-Rg.woff2 와 글자 목록 src/assets/fonts/cherrie-charset.txt
- 앱 소스(App.jsx, lib, data/news.js)에 새 한글이 생기면 다시 실행해야 한다.
  (test/cherrieFont.test.js가 빠진 글자를 알려준다. 서체에 없는 글자는 기본 서체로 대신 표시되어 앱은 깨지지 않는다.)
필요: pip3 install fonttools brotli
"""
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent.parent
fonts = root / "src/assets/fonts"
source_ttf = fonts / "Griun_Cherrie-Rg.ttf"
out_woff2 = fonts / "Griun_Cherrie-Rg.woff2"
charset_file = fonts / "cherrie-charset.txt"

sources = [root / "src/App.jsx", root / "src/data/news.js", *sorted((root / "src/lib").glob("*.js"))]
hangul = set()
for path in sources:
    hangul.update(re.findall(r"[가-힣ㄱ-ㅎㅏ-ㅣ]", path.read_text(encoding="utf-8")))

# 한글 외에 항상 포함: 기본 라틴·숫자·기호, 흔한 문장부호·화살표·체크
fixed = set()
for start, end in [(0x20, 0x7E), (0xA0, 0xFF), (0x2010, 0x2027), (0x2190, 0x2193), (0x3000, 0x303F)]:
    fixed.update(chr(code) for code in range(start, end + 1))
fixed.update("✓×·…→←♧⚠")

chars = sorted(hangul | fixed)
charset_file.write_text("".join(chars), encoding="utf-8")

command = [
    sys.executable, "-m", "fontTools.subset", str(source_ttf),
    f"--text-file={charset_file}", "--flavor=woff2", f"--output-file={out_woff2}",
    "--layout-features=*", "--no-hinting", "--desubroutinize",
]
subprocess.run(command, check=True)
print(f"한글 {len(hangul)}자 + 기본 {len(fixed)}자 → {out_woff2.stat().st_size:,} bytes")
