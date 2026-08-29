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

# Space Grotesk 與 IBM Plex Mono 走靜態字重 —— 兩者合計才 33KB，
# 而 IBM Plex Mono 在 Google Fonts 上也沒有可變字型版本。
CSS_URL = ("https://fonts.googleapis.com/css2?"
           "family=Space+Grotesk:wght@300;400;500"
           "&family=IBM+Plex+Mono:wght@400;500"
           "&display=swap")

# Noto Sans TC 改用可變字型：站上用到 200/300/400/500 四個字重，
# 以前是四個靜態檔 595KB，現在是一個檔案涵蓋整段 200–500。
# 它佔首頁下載量九成以上，是這個網站唯一值得壓的東西。
#
# 這裡直接抓 google/fonts 上游的可變字型原始檔（11MB），而不是走 Google Fonts
# 的 CSS API —— API 送的可變字型已經照 unicode-range 切成上百個分片，
# 我們要自己重新子集化，需要的是未分割的完整檔。
VARIABLE = [{
    "family": "Noto Sans TC",
    "url": "https://github.com/google/fonts/raw/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf",
    "axis": "wght",
    "lo": 200,
    "hi": 500,
}]

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


def subset(src, dest, text_file):
    subprocess.run([
        "pyftsubset", str(src),
        f"--text-file={text_file}",
        "--flavor=woff2",
        f"--output-file={dest}",
        "--layout-features=*",       # 保留 kerning 等排版特性
        "--no-hinting",
        "--desubroutinize",
    ], check=True)


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
        subset(ttf, woff2, text_file)
        ttf.unlink()
        size = woff2.stat().st_size
        total += size
        print(f"  {family} {weight}: {size // 1024}KB")
        out_css.append(
            f"@font-face{{font-family:'{family}';font-style:{style};"
            f"font-weight:{weight};font-display:swap;"
            f"src:url('./{name}.woff2') format('woff2')}}")

    for vf in VARIABLE:
        family, lo, hi = vf["family"], vf["lo"], vf["hi"]
        name = slug(family, f"{lo}-{hi}-var")
        raw = OUT / f".{name}.ttf"
        raw.write_bytes(fetch(vf["url"], ua="Mozilla/5.0"))

        # 先把軸範圍砍到站上真正用得到的區間，再子集化字元。
        # 少了用不到的字重端點，內插資料也跟著少。
        limited = OUT / f".{name}.limited.ttf"
        subprocess.run(["fonttools", "varLib.instancer", str(raw),
                        f"{vf['axis']}={lo}:{hi}", "-o", str(limited)],
                       check=True, capture_output=True)
        woff2 = OUT / f"{name}.woff2"
        subset(limited, woff2, text_file)
        raw.unlink(); limited.unlink()

        size = woff2.stat().st_size
        total += size
        print(f"  {family} {lo}–{hi}（可變字型）: {size // 1024}KB")
        out_css.append(
            f"@font-face{{font-family:'{family}';font-style:normal;"
            f"font-weight:{lo} {hi};font-display:swap;"     # 範圍寫法，瀏覽器自行內插
            # 用 format('woff2') 而不是 'woff2-variations' —— 後者是過渡期寫法，
            # 部分瀏覽器不認得，會整條 @font-face 跳過，字型就完全不生效。
            f"src:url('./{name}.woff2') format('woff2')}}")

    text_file.unlink()
    (OUT / "fonts.css").write_text("\n".join(out_css) + "\n", encoding="utf-8")

    # 清掉沒有被 fonts.css 引用的舊產物 —— 改過字重清單（或像這次從四個靜態字重
    # 換成一個可變字型）之後，上一輪的檔案會留在原地，白白進版控又沒人載入。
    css_text = (OUT / "fonts.css").read_text(encoding="utf-8")
    for stale in sorted(OUT.glob("*.woff2")):
        if stale.name not in css_text:
            print(f"  移除孤兒檔 {stale.name}（{stale.stat().st_size // 1024}KB）")
            stale.unlink()
    print(f"共 {len(faces)} 個靜態字重 + {len(VARIABLE)} 個可變字型，"
          f"{total // 1024}KB → {OUT.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
