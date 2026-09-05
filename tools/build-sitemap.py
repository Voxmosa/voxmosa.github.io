#!/usr/bin/env python3
"""Regenerate sitemap.xml -- python3 tools/build-sitemap.py

<lastmod> is the only field Google reads here. Its docs say the value is used
"if it's consistently and verifiably accurate", so a hand-typed date is worse
than useless once it drifts: an inaccurate lastmod makes Google distrust the
field entirely. Every date is therefore derived, never written by hand.

A file with uncommitted changes gets today's date, because it is about to be
committed today. Everything else gets the date of the commit that last touched
it. test/link-check.js asserts the file still matches, so it cannot rot quietly.

<changefreq> and <priority> are deliberately absent: "Google ignores <priority>
and <changefreq> values."
"""
import datetime, pathlib, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = "https://voxmosa.com/"
PAGES = ["index.html", "mosatalk.html", "mosaminutes.html", "mosascore.html",
         "on-premise.html", "languages.html"]


def last_modified(name):
    dirty = subprocess.run(["git", "status", "--porcelain", "--", name],
                           cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if dirty:
        return datetime.date.today().isoformat()
    out = subprocess.run(["git", "log", "-1", "--format=%cs", "--", name],
                         cwd=ROOT, capture_output=True, text=True).stdout.strip()
    if not out:
        sys.exit(f"{name} 還沒有任何 commit，無法推導 lastmod")
    return out


def build():
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for name in PAGES:
        loc = BASE if name == "index.html" else BASE + name
        lines += ["  <url>", f"    <loc>{loc}</loc>",
                  f"    <lastmod>{last_modified(name)}</lastmod>", "  </url>"]
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    (ROOT / "sitemap.xml").write_text(build(), encoding="utf-8")
    for name in PAGES:
        print(f"  {name:<20} {last_modified(name)}")
    print(f"共 {len(PAGES)} 個網址 → sitemap.xml")
