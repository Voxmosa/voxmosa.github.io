#!/usr/bin/env node
//
// 渲染回歸測試 —— node test/render-check.js
//
// 這個網站是用戶端渲染的：版面寫在 <x-dc> 模板裡，由 support.js 載入 React
// 後才渲染出來。最需要防的失敗不是「畫面跑版」，而是「整頁全白」，
// 所以這裡量的是 document.body.innerText 的長度 —— innerText 天生排除
// display:none 的內容，等於「使用者實際看得到多少字」。
//
// 零依賴：自己起 HTTP server，用 Chrome DevTools Protocol 驅動 headless Chrome。
// 需要 Node 22+（用到內建的 fetch 與 WebSocket）。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PAGES = ["index.html", "mosatalk.html", "mosaminutes.html", "mosascore.html"];

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
    expect: i => i.visibleText >= MIN_VISIBLE && i.hasDcRoot && !i.hasXdc,
    note: "React 渲染成功，x-dc 已被 #dc-root 取代" },

  { key: "blocked", label: "React 檔案抓不到", wait: 7000,
    setup: s => s.send("Network.setBlockedURLs", { urls: ["*react*.js"] }),
    expect: i => i.visibleText >= MIN_VISIBLE && i.hasXdc,
    note: "本地與 unpkg 都拿不到 React，兜底看門狗把原始模板顯示回來（沒有它就是全白頁）" },

  { key: "nojs", label: "JavaScript 關閉", wait: 5000,
    setup: s => s.send("Emulation.setScriptExecutionDisabled", { value: true }),
    expect: i => i.visibleText >= MIN_VISIBLE,
    note: "support.js 不執行，模板本來就可見" },

  { key: "slow", label: "極慢網路 30KB/s", wait: 45000, checkNoCdn: true,
    setup: s => s.send("Network.emulateNetworkConditions", {
      offline: false, latency: 600, downloadThroughput: 30 * 1024, uploadThroughput: 30 * 1024 }),
    expect: i => i.visibleText >= MIN_VISIBLE && i.hasDcRoot && !i.hasXdc,
    note: "看門狗不會在 React 還在路上時就過早開燈" },
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
  for (const sc of SCENARIOS) {
    if (only && sc.key !== only) continue;
    console.log(`══════ ${sc.label} ══════`);
    console.log(`預期：${sc.note}`);
    for (const page of PAGES) {
      const i = await runOne(chromePath, base, page, sc, port++);
      const pass = sc.expect(i);
      if (!pass) failures++;
      console.log(`${pass ? "✅" : "❌"} ${page.padEnd(17)} 可見文字 ${String(i.visibleText).padStart(5)} 字  ` +
                  `x-dc=${i.hasXdc ? "在" : "無"}  dc-root=${i.hasDcRoot ? "在" : "無"}  React=${i.react}`);
      if (!pass) console.log(`   └ 實際畫面：${i.head || "（空白）"}`);
      // 自架 React 之後，正常運作時唯一該出現的外部網域只剩 Google Fonts。
      // 只在本地 React 可用的情境檢查 —— 一旦本地檔案被擋掉，support.js 會
      // 依設計回頭去抓 unpkg 當備援，那些請求出現在這裡是正常的。
      // React 與字型都自架之後，正常運作時應該完全沒有對外請求。
      // 只在本地資源可用的情境檢查 —— 一旦本地檔案被擋掉，support.js 會
      // 依設計回頭去抓 unpkg 當備援，那些請求出現在這裡是正常的。
      if (sc.checkNoCdn && i.external.length) {
        failures++;
        console.log(`   └ ❌ 出現 ${i.external.length} 個外部請求：${i.external[0]}`);
      }
      if (i.errors.length) console.log(`   └ ⚠️  console 例外：${i.errors[0].split("\n")[0]}`);
    }
    console.log("");
  }
  server.close();
  console.log(failures ? `❌ ${failures} 項失敗` : "✅ 全部通過");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
