#!/usr/bin/env node
//
// 把 <x-dc> 頁面烘焙成純靜態 HTML —— node tools/bake.js <page.html>
//
// 用戶端渲染的存在理由是 Claude Design 這個視覺編輯器，編輯器退場後這層成本
// 就換不到東西了。烘焙後可移除 support.js（69KB）與 React（142KB），
// 首屏不必等 JS，白畫面風險與兜底看門狗也一併消失。
//
// 做法是「改寫原始碼結構」，而不是「輸出渲染後的 DOM」：
// 渲染結果是一整行沒有斷行的 HTML，之後沒人能維護；原始模板本來就排版good，
// 保留它才符合「今後直接編輯 HTML」的目的。
//
// 保留 #dc-root > .sc-host 兩層包裝是刻意的 —— DOM 結構不變，
// test/layout-check.js 的基準才能逐像素證明烘焙前後等價。
//
// ⚠️ 只處理沒有執行期內容的頁面。含 {{ }}、<sc-for>、<sc-if>、data-dc-script
//    的頁面會被拒絕，那些需要先把動態部分移植成原生 JS。

const fs = require("fs");
const path = require("path");

const FULL_PAGE_CSS =
  "html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}";

const file = process.argv[2];
if (!file) { console.error("用法：node tools/bake.js <page.html>"); process.exit(2); }

const src = fs.readFileSync(file, "utf8");

// ── 先擋掉還不能烘焙的頁面 ───────────────────────────────────────────
const dynamic = [];
const body = src.slice(src.indexOf("<x-dc>"));
if (/<sc-for\b/.test(body)) dynamic.push("<sc-for> 迴圈");
if (/<sc-if\b/.test(body)) dynamic.push("<sc-if> 條件");
if (/<script type="text\/x-dc"/.test(src)) dynamic.push("data-dc-script 元件邏輯");
if (/style-hover="/.test(body)) dynamic.push("style-hover 懸停樣式");
// {{ }} 只算模板內的，不算腳本註解裡的
const tplOnly = body.replace(/<script[\s\S]*?<\/script>/g, "");
if (/\{\{/.test(tplOnly)) dynamic.push("{{ }} 插值");

if (dynamic.length) {
  console.error(`${file} 還不能烘焙，含有執行期內容：`);
  for (const d of dynamic) console.error(`  - ${d}`);
  console.error("請先把這些部分移植成原生 JS 或靜態標記。");
  process.exit(1);
}

// ── 取出 <x-dc> 內容與其中的 <helmet> ────────────────────────────────
const xdcOpen = src.indexOf("<x-dc>");
const xdcClose = src.lastIndexOf("</x-dc>");
if (xdcOpen === -1 || xdcClose === -1) { console.error("找不到 <x-dc>"); process.exit(1); }
let content = src.slice(xdcOpen + "<x-dc>".length, xdcClose);

let helmet = "";
const hOpen = content.indexOf("<helmet>");
const hClose = content.indexOf("</helmet>");
if (hOpen !== -1 && hClose !== -1) {
  helmet = content.slice(hOpen + "<helmet>".length, hClose).trim();
  content = content.slice(0, hOpen) + content.slice(hClose + "</helmet>".length);
}

// ── 整理 <head>：拿掉 runtime 與兜底，剩下的照原順序保留 ──────────────
let head = src.slice(src.indexOf("<head>") + "<head>".length, src.indexOf("</head>"));
const strip = [
  /^[ \t]*<script src="\.\/vendor\/react[^>]*><\/script>\n/gm,
  /^[ \t]*<script src="\.\/support\.js"><\/script>\n/gm,
  /^[ \t]*<!-- 兜底：[\s\S]*?-->\n/gm,
  /^[ \t]*<script>\n\(function \(\) \{\n[\s\S]*?\n\}\)\(\);\n<\/script>\n/gm,
  /^[ \t]*<!-- JS 關閉時[\s\S]*?-->\n/gm,
  /^[ \t]*<noscript><style>x-dc\{[^<]*<\/style><\/noscript>\n/gm,
];
for (const re of strip) head = head.replace(re, "");

// helmet 也帶了一份 viewport，與 <head> 裡的重複
const helmetLines = helmet.split("\n").filter((l) => !/<meta name="viewport"/.test(l));

// </x-dc> 之後的 <script> 是頁面自己的原生 JS（例如移植過來的動畫），
// 必須帶進烘焙結果 —— 漏掉的話動畫會靜悄悄地消失，頁面看起來仍然正常。
const afterTemplate = src.slice(xdcClose + "</x-dc>".length, src.indexOf("</body>"));
const trailing = (afterTemplate.match(/<script[\s\S]*?<\/script>/g) || [])
  .filter((t) => !/type="text\/x-dc"/.test(t))
  .join("\n");

const out = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>${head.replace(/\n+$/, "\n")}${helmetLines.join("\n")}
<style>${FULL_PAGE_CSS}</style>
</head>
<body>
<div id="dc-root"><div class="sc-host">${content.replace(/\n+$/, "\n")}</div></div>${trailing ? "\n" + trailing : ""}
</body>
</html>
`;

fs.writeFileSync(file, out);
const before = Buffer.byteLength(src), after = Buffer.byteLength(out);
console.log(`✅ ${path.basename(file)}：${Math.round(before / 1024)}KB → ${Math.round(after / 1024)}KB`);
console.log("   已移除 React、support.js、兜底看門狗；請跑 test/layout-check.js 驗證等價");
if (trailing) console.log(`   保留了 ${(trailing.match(/<script/g) || []).length} 段頁面自有的 JS`);
