#!/usr/bin/env node
//
// 渲染回歸測試 —— node test/render-check.js
//
// 四個頁面都是純靜態 HTML（見 tools/bake.js）。最該防的退步是「內容其實
// 依賴 JavaScript 才看得到」，所以這裡量 document.body.innerText 的長度 ——
// innerText 天生排除 display:none 的內容，等於「使用者實際看得到多少字」——
// 並斷言關掉 JavaScript 之後這個數字完全不變。
//
// 零依賴：自己起 HTTP server，用 Chrome DevTools Protocol 驅動 headless Chrome。
// 需要 Node 22+（用到內建的 fetch 與 WebSocket）。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PAGES = ["index.html", "mosatalk.html", "mosaminutes.html", "mosascore.html"];

// 靜態頁不該留下任何 <x-dc> 模板殘跡
const isBaked = (page) =>
  !fs.readFileSync(path.join(ROOT, page), "utf8").includes("<x-dc>");

// 每頁至少要看得到這麼多字，才算沒有變成空白頁。
// 最小的 mosatalk 靜態模板約 2000 字，抓 500 保留餘裕。
const MIN_VISIBLE = 500;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
               ".png": "image/png", ".svg": "image/svg+xml",
               ".woff2": "font/woff2" };

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  const found = CHROME_CANDIDATES.find(p => fs.existsSync(p));
  if (!found) {
    console.error("找不到 Chrome。試過：\n  " + CHROME_CANDIDATES.join("\n  "));
    process.exit(2);
  }
  return found;
}

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r(server)));
}

async function cdp(port) {
  let list;
  for (let i = 0; i < 30; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; }
    catch { await sleep(400); }
  }
  if (!list) throw new Error("連不上 Chrome 的除錯埠");
  const sock = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const state = { requests: [], errors: [] };
  sock.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === "Network.requestWillBeSent") state.requests.push(m.params.request.url);
    if (m.method === "Runtime.exceptionThrown")
      state.errors.push(m.params.exceptionDetails.exception?.description || "exception");
  };
  const send = (method, params) => new Promise(res => {
    const myId = ++id; pending.set(myId, res);
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
  return { send, state, close: () => sock.close() };
}

const PROBE = `JSON.stringify({
  visibleText: document.body.innerText.trim().length,
  head: document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60),
  hasXdc: !!document.querySelector('x-dc'),
  hasDcRoot: !!document.getElementById('dc-root'),
  react: typeof window.React
})`;

const SCENARIOS = [
  { key: "normal", label: "正常載入", wait: 4000, checkNoCdn: true,
    expect: i => i.visibleText >= MIN_VISIBLE && !i.hasXdc,
    note: "內容直接來自 HTML，沒有模板殘跡" },


  { key: "nojs", label: "JavaScript 關閉", wait: 5000,
    setup: s => s.send("Emulation.setScriptExecutionDisabled", { value: true }),
    expect: i => i.visibleText >= MIN_VISIBLE,
    note: "靜態 HTML，關掉 JavaScript 內容照樣完整" },

  { key: "slow", label: "極慢網路 30KB/s", wait: 45000, checkNoCdn: true,
    setup: s => s.send("Network.emulateNetworkConditions", {
      offline: false, latency: 600, downloadThroughput: 30 * 1024, uploadThroughput: 30 * 1024 }),
    expect: i => i.visibleText >= MIN_VISIBLE && !i.hasXdc,
    note: "慢速連線下仍然完整顯示" },
];

async function runOne(chromePath, base, page, scenario, debugPort) {
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${debugPort}`,
    "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=/tmp/voxmosa-render-check-${debugPort}`, "about:blank"], { stdio: "ignore" });
  try {
    const s = await cdp(debugPort);
    await s.send("Page.enable");
    await s.send("Network.enable");
    await s.send("Runtime.enable");
    if (scenario.setup) await scenario.setup(s);
    await s.send("Page.navigate", { url: base + page });
    await sleep(scenario.wait);
    const r = await s.send("Runtime.evaluate", { expression: PROBE, returnByValue: true });
    const info = JSON.parse(r.result.value);
    info.external = s.state.requests.filter(u => !u.startsWith(base) && !u.startsWith("data:"));
    info.errors = s.state.errors;
    s.close();
    return info;
  } finally { chrome.kill(); }
}

(async () => {
  const only = process.argv[2];  // 例如 node test/render-check.js blocked
  const chromePath = findChrome();
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  console.log(`站台根目錄 ${ROOT}\n瀏覽器     ${chromePath}\n`);

  let port = 9400, failures = 0;
  const seen = {};
  for (const sc of SCENARIOS) {
    if (only && sc.key !== only) continue;
    console.log(`══════ ${sc.label} ══════`);
    console.log(`預期：${sc.note}`);
    for (const page of PAGES) {
      const i = await runOne(chromePath, base, page, sc, port++);
      const baked = isBaked(page);
      const pass = sc.expect(i, baked);
      if (baked) seen[sc.key + "|" + page] = i.visibleText;
      if (!pass) failures++;
      console.log(`${pass ? "✅" : "❌"} ${page.padEnd(17)} 可見文字 ${String(i.visibleText).padStart(5)} 字  ` +
                  `x-dc=${i.hasXdc ? "在" : "無"}  dc-root=${i.hasDcRoot ? "在" : "無"}  React=${i.react}`);
      if (!pass) console.log(`   └ 實際畫面：${i.head || "（空白）"}`);
      // 字型自架、runtime 移除之後，頁面完全不該對外發出請求。
      if (sc.checkNoCdn && i.external.length) {
        failures++;
        console.log(`   └ ❌ 出現 ${i.external.length} 個外部請求：${i.external[0]}`);
      }
      // 正常情境下的 JS 例外一律視為失敗。移植動畫時踩過兩次「頁面看起來
      // 正常、功能其實已死」——腳本被烘焙工具丟掉、以及 data-* 掛鉤與資料
      // 屬性撞名把整列內容清空。兩者都只在 console 留下一行例外。
      if (i.errors.length) {
        const fatal = sc.key === "normal" || sc.key === "slow";
        if (fatal) failures++;
        console.log(`   └ ${fatal ? "❌" : "⚠️ "} JS 例外：${i.errors[0].split("\n")[0]}`);
      }
    }
    console.log("");
  }
  // 烘焙的重點就在這裡：靜態頁在有無 JavaScript 之下必須完全一樣
  const bakedPages = PAGES.filter(isBaked);
  if (bakedPages.length) {
    console.log("══════ 靜態頁：JS 開關不影響內容 ══════");
    for (const page of bakedPages) {
      const on = seen["normal|" + page], off = seen["nojs|" + page];
      const same = on !== undefined && on === off;
      if (!same) failures++;
      console.log((same ? "✅ " : "❌ ") + page.padEnd(17) +
                  " 有 JS " + on + " 字 / 無 JS " + off + " 字");
    }
    console.log("");
  }

  server.close();
  console.log(failures ? `❌ ${failures} 項失敗` : "✅ 全部通過");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
