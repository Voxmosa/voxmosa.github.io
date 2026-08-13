#!/usr/bin/env python3
"""把 Google Fonts 的字型子集化後自架 —— python3 tools/build-fonts.py

產出 vendor/fonts/*.woff2 與 vendor/fonts/fonts.css，頁面只要 link 那支 CSS。

為什麼要子集化：Noto Sans TC 完整檔每個字重都是好幾 MB，直接自架反而比
Google Fonts 慢。這裡只保留站上實際用到的字元（目前約 1000 個，其中 978 個
是中日韓字），四個字重加起來壓到可以接受的大小。

⚠️  改過任何頁面文案之後要重跑這支腳本，否則新字會變成豆腐格。
    字元集是從四個 HTML 的原始碼取聯集，所以連只在 JavaScript 執行後才
    出現的字串（例如動畫裡的文字）也會被涵蓋。

需要 fonttools 與 brotli：
    python3 -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python tools/build-fonts.py
"""
import pathlib, re, subprocess, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "vendor" / "fonts"
PAGES = ["index.html", "mosatalk.html", "mosaminutes.html", "mosascore.html"]

CSS_URL = ("https://fonts.googleapis.com/css2?"
           "family=Space+Grotesk:wght@300;400;500"
           "&family=IBM+Plex+Mono:wght@400;500"
           "&family=Noto+Sans+TC:wght@200;300;400;500"
           "&display=swap")

# 舊版 UA 讓 Google 回傳未分割的完整 .ttf，方便自己重新子集化
OLD_UA = "Mozilla/4.0"


def fetch(url, ua=OLD_UA):
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req) as r:
        return r.read()


def charset():
    chars = set()
    for name in PAGES:
        chars |= set((ROOT / name).read_text(encoding="utf-8"))
    chars |= {chr(c) for c in range(0x20, 0x7F)}   # 完整可列印 ASCII，留餘裕
    return "".join(sorted(c for c in chars if c.isprintable() or c == " "))


def slug(family, weight):
    return re.sub(r"[^a-z0-9]+", "-", family.lower()).strip("-") + f"-{weight}"


def main():
    try:
        subprocess.run(["pyftsubset", "--help"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        sys.exit("找不到 pyftsubset。請先安裝 fonttools 與 brotli（見檔頭說明）。")

    OUT.mkdir(parents=True, exist_ok=True)
    text = charset()
    text_file = OUT / ".charset.txt"
    text_file.write_text(text, encoding="utf-8")
    cjk = sum(1 for c in text if ord(c) > 0x2E80)
    print(f"字元集：{len(text)} 個，其中 {cjk} 個中日韓與全形符號")

    css = fetch(CSS_URL).decode("utf-8")
    faces = re.findall(
        r"font-family: '([^']+)';\s*font-style: (\w+);\s*font-weight: (\d+);"
        r"[^}]*?src: url\(([^)]+)\)", css, re.S)
    if not faces:
        sys.exit("解析 Google Fonts CSS 失敗")

    out_css = ["/* 由 tools/build-fonts.py 產生 —— 不要手動編輯。",
               "   改過頁面文案後請重跑，否則新字會缺字。 */"]
    total = 0
    for family, style, weight, url in faces:
        name = slug(family, weight)
        ttf = OUT / f".{name}.ttf"
        ttf.write_bytes(fetch(url))
        woff2 = OUT / f"{name}.woff2"
        subprocess.run([
            "pyftsubset", str(ttf),
            f"--text-file={text_file}",
            "--flavor=woff2",
            f"--output-file={woff2}",
            "--layout-features=*",       # 保留 kerning 等排版特性
            "--no-hinting",
            "--desubroutinize",
        ], check=True)
        ttf.unlink()
        size = woff2.stat().st_size
        total += size
        print(f"  {family} {weight}: {size // 1024}KB")
        out_css.append(
            f"@font-face{{font-family:'{family}';font-style:{style};"
            f"font-weight:{weight};font-display:swap;"
            f"src:url('./{name}.woff2') format('woff2')}}")

    text_file.unlink()
    (OUT / "fonts.css").write_text("\n".join(out_css) + "\n", encoding="utf-8")
    print(f"共 {len(faces)} 個字重，{total // 1024}KB → {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
