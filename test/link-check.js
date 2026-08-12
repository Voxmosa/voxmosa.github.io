#!/usr/bin/env node
//
// 連結檢查 —— node test/link-check.js
//
// 檢查每一個站內連結是否真的到得了：目標檔案存在，且錨點指向的 id 存在。
// 站外連結只列出來，不連線驗證（避免測試依賴外部網路而變得不穩定）。
//
// 這支測試的由來：子頁的「技術實力」「為什麼地端」曾指向
// `Voxmosa Home.dc.html#tech` —— 那是編輯器留下的檔名，repo 裡沒有這個檔案，
// 點下去就是 404。render-check 與 layout-check 都看不到這種錯，
// 因為頁面本身渲染得好好的，壞的是連結目的地。
//
// 零依賴、不需瀏覽器，跑起來不到一秒。

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PAGES = ["index.html", "mosatalk.html", "mosaminutes.html", "mosascore.html"];

const idsOf = (src) => new Set([...src.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

const pages = new Map(
  PAGES.map((p) => {
    const src = fs.readFileSync(path.join(ROOT, p), "utf8");
    return [p, { src, ids: idsOf(src) }];
  })
);

let failures = 0;
let internal = 0;
const external = new Set();

for (const [page, { src }] of pages) {
  const problems = [];
  for (const m of src.matchAll(/<a\s[^>]*href="([^"]*)"/g)) {
    const href = m[1];
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    // {{ }} 是 dc-runtime 的樣板插值，實際值要到執行期才知道
    if (href.includes("{{")) continue;
    if (/^https?:\/\//.test(href)) { external.add(href); continue; }

    internal++;
    const [file, frag] = href.split("#");
    const target = file === "" ? page : file;          // 純錨點 = 指向本頁

    const entry = pages.get(target);
    if (!entry) {
      // 不在四個頁面內，可能是圖片之類的靜態檔
      if (!fs.existsSync(path.join(ROOT, decodeURIComponent(target)))) {
        problems.push(`${href}  →  檔案不存在`);
        continue;
      }
      if (frag) problems.push(`${href}  →  無法檢查錨點（非 HTML 頁面）`);
      continue;
    }
    if (frag && !entry.ids.has(frag)) {
      problems.push(`${href}  →  ${target} 裡沒有 id="${frag}"`);
    }
  }

  if (problems.length) {
    failures += problems.length;
    console.log(`❌ ${page}`);
    for (const p of [...new Set(problems)]) console.log(`     ${p}`);
  } else {
    console.log(`✅ ${page}`);
  }
}

// 導覽列在各頁之間應該一致 —— mosascore 曾經漏掉「技術實力」
const NAV = ["MosaTalk", "MosaMinutes", "MosaScore", "技術實力", "為什麼地端"];
console.log("\n導覽列一致性：");
for (const [page, { src }] of pages) {
  const header = src.slice(0, src.indexOf("</header>") + 1 || 30000);
  const missing = NAV.filter((label) => !header.includes(`>${label}</a>`));
  if (missing.length) {
    failures += missing.length;
    console.log(`❌ ${page.padEnd(18)} 缺少：${missing.join("、")}`);
  } else {
    console.log(`✅ ${page.padEnd(18)} 五個項目齊全`);
  }
}

console.log(`\n站內連結 ${internal} 個，站外 ${external.size} 個（未連線驗證）`);
console.log(failures ? `❌ ${failures} 個問題` : "✅ 全部通過");
process.exit(failures ? 1 : 0);
