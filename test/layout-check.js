#!/usr/bin/env node
//
// 版面回歸測試 —— node test/layout-check.js [--save]
//
//   --save   重新產生基準（test/baseline/）
//   （無參數）與基準比對，有差異就列出並以非零狀態結束
//
// 為什麼這樣做：render-check.js 只驗「看不看得到內容」，完全不驗版面。
// 而頁面的 RWD 目前是靠比對 inline style 字串的 [style*="..."] 選擇器實作的，
// 要把它重構成具名 class 就需要一張版面的安全網。
//
// 識別元素用「DOM 位置路徑」而非選擇器：重構會改變 style 屬性、新增 class，
// 但不動 DOM 結構，所以位置是唯一能跨重構對齊的識別碼。
// 記錄的是 bounding rect（使用者實際看到的結果）加上那幾個被 media query
// hack 的屬性，涵蓋重構可能弄壞的東西。
//
// 零依賴，需 Node 22+ 與本機 Chrome。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BASELINE = path.join(__dirname, "baseline");
const CURRENT = path.join(__dirname, "current");
const PAGES = ["index.html", "mosatalk.html", "mosaminutes.html", "mosascore.html"];

// 手機 / 平板 / 桌機 —— 對齊頁面 media query 的斷點（480/900/1080）
const WIDTHS = [375, 768, 1440];

const TOLERANCE_PX = 1;  // 容許次像素與字型 hinting 造成的微小差異

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
  if (!found) { console.error("找不到 Chrome"); process.exit(2); }
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
  if (!list) throw new Error("連不上 Chrome");
  const sock = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  let id = 0; const pending = new Map();
  sock.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise(res => {
    const myId = ++id; pending.set(myId, res);
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
  return { send, close: () => sock.close() };
}

// 讓量測結果可重現：關掉 hero 的自動播放動畫，並停用 CSS 動畫與轉場。
const SETTLE = `(function () {
  try {
    var n = window.__dcRootName && window.__dcRootName();
    if (n && window.__dcSetProps) window.__dcSetProps(n, { demoAutoplay: false });
  } catch (e) {}
  var s = document.createElement("style");
  s.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;" +
                  "caret-color:transparent!important}";
  document.head.appendChild(s);
  return document.fonts ? document.fonts.ready.then(function () { return true; }) : true;
})()`;

// 每個元素一行：路徑|x,y,w,h|display|grid-template-columns|gap|font-size|padding|max-width
// 純文字讓 git diff 直接看得懂哪個元素在哪個寬度下跑掉了。
const SNAPSHOT = `(function () {
  var out = [];
  function walk(el, p) {
    var r = el.getBoundingClientRect();
    var c = getComputedStyle(el);
    out.push([
      p, [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(","),
      c.display, c.gridTemplateColumns, c.gap, c.fontSize, c.padding, c.maxWidth
    ].join("|"));
    for (var i = 0; i < el.children.length; i++) walk(el.children[i], p + "/" + i);
  }
  walk(document.body, "body");
  return out.join("\\n");
})()`;

async function capture(chromePath, base, page, width, port) {
  const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    `--user-data-dir=/tmp/voxmosa-layout-${port}`, "about:blank"], { stdio: "ignore" });
  try {
    const s = await cdp(port);
    await s.send("Page.enable");
    await s.send("Runtime.enable");
    await s.send("Emulation.setDeviceMetricsOverride", {
      width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    await s.send("Page.navigate", { url: base + page });
    await sleep(3500);
    await s.send("Runtime.evaluate", { expression: SETTLE, awaitPromise: true, returnByValue: true });
    await sleep(600);

    // 同一次載入內取兩張快照，間隔一段時間。凡是自己就會變的欄位（例如 hero
    // 那組 JS 驅動的聲波柱）標成 "*"，之後比對時視為萬用字元 —— 讓量測器自己
    // 找出雜訊，不必人工維護一份「請忽略這些元素」的清單。
    const a = (await s.send("Runtime.evaluate", { expression: SNAPSHOT, returnByValue: true })).result.value;
    await sleep(900);
    const b = (await s.send("Runtime.evaluate", { expression: SNAPSHOT, returnByValue: true })).result.value;
    const shot = await s.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    s.close();
    return { layout: maskUnstable(a, b), png: Buffer.from(shot.data, "base64") };
  } finally { chrome.kill(); }
}

function maskUnstable(a, b) {
  const la = a.split("\n"), lb = b.split("\n");
  if (la.length !== lb.length) return a;  // 結構自己在變，交給比對階段報告
  return la.map((line, i) => {
    if (line === lb[i]) return line;
    const fa = line.split("|"), fb = lb[i].split("|");
    return fa.map((v, k) => (k === 0 || v === fb[k]) ? v : "*").join("|");
  }).join("\n");
}

// 沿用舊基準已標記的 "*"，讓遮罩只增不減。DOM 結構變動時直接採用新的，
// 因為行與行的對應關係已經不成立了。
function mergeMasks(oldTxt, newTxt) {
  const a = oldTxt.split("\n"), b = newTxt.split("\n");
  if (a.length !== b.length) return newTxt;
  return b.map((line, i) => {
    const fo = a[i].split("|"), fn = line.split("|");
    if (fo[0] !== fn[0]) return line;          // 路徑對不上，不合併
    return fn.map((v, k) => (fo[k] === "*" ? "*" : v)).join("|");
  }).join("\n");
}

function compare(name, before, after) {
  const a = before.split("\n"), b = after.split("\n");
  const diffs = [];
  if (a.length !== b.length) {
    diffs.push(`元素數量不同：基準 ${a.length} → 現在 ${b.length}（DOM 結構被改動了）`);
    return diffs;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const fa = a[i].split("|"), fb = b[i].split("|");
    // "*" 是量測階段標出的不穩定欄位，兩邊任一為 "*" 就跳過
    const wild = (x, y) => x === "*" || y === "*";
    // rect 容許 TOLERANCE_PX 的誤差，其餘欄位必須完全相同
    let rectOff = false;
    if (!wild(fa[1], fb[1])) {
      const ra = fa[1].split(",").map(Number), rb = fb[1].split(",").map(Number);
      rectOff = ra.some((v, k) => Math.abs(v - rb[k]) > TOLERANCE_PX);
    }
    const propsOff = fa.slice(2).some((v, k) => !wild(v, fb[k + 2]) && v !== fb[k + 2]);
    if (!rectOff && !propsOff) continue;
    const LABEL = ["", "rect", "display", "grid-template-columns", "gap", "font-size", "padding", "max-width"];
    const changed = [];
    if (rectOff) changed.push(`rect ${fa[1]} → ${fb[1]}`);
    fa.slice(2).forEach((v, k) => {
      if (v !== "*" && fb[k + 2] !== "*" && v !== fb[k + 2])
        changed.push(`${LABEL[k + 2]} ${v} → ${fb[k + 2]}`);
    });
    diffs.push(`  ${fa[0]}\n    ${changed.join("\n    ")}`);
  }
  return diffs;
}

(async () => {
  const save = process.argv.includes("--save");
  const chromePath = findChrome();
  fs.mkdirSync(BASELINE, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  console.log(save ? "產生基準…\n" : "與基準比對…\n");

  let port = 9500, failures = 0, checked = 0;
  for (const page of PAGES) {
    for (const width of WIDTHS) {
      const key = `${page.replace(".html", "")}-${width}`;
      const txt = path.join(BASELINE, `${key}.txt`);
      const png = path.join(BASELINE, `${key}.png`);  // 只有 --save 會寫這個
      const { layout, png: shot } = await capture(chromePath, base, page, width, port++);

      if (save) {
        // 遮罩單調累積：一旦某欄位被觀察到會自己變動，就永遠視為不穩定。
        // 否則某根聲波柱剛好在兩次快照間靜止，就會被記成具體數值，
        // 造成基準每次重產都不一樣，日後還可能被誤報成跑版。
        const merged = fs.existsSync(txt)
          ? mergeMasks(fs.readFileSync(txt, "utf8"), layout)
          : layout;
        fs.writeFileSync(txt, merged);
        fs.writeFileSync(png, shot);
        console.log(`✅ ${key.padEnd(22)} ${layout.split("\n").length} 個元素  截圖 ${Math.round(shot.length / 1024)}KB`);
        continue;
      }
      if (!fs.existsSync(txt)) { console.log(`⚠️  ${key} 沒有基準，請先跑 --save`); continue; }
      checked++;
      const diffs = compare(key, fs.readFileSync(txt, "utf8"), layout);
      // 比對模式的截圖寫到 current/，絕不覆寫基準 ——
      // 覆寫等於毀掉「前後對照」這件事本身
      fs.mkdirSync(CURRENT, { recursive: true });
      fs.writeFileSync(path.join(CURRENT, `${key}.png`), shot);
      if (!diffs.length) { console.log(`✅ ${key.padEnd(22)} 版面一致`); continue; }
      failures++;
      console.log(`❌ ${key.padEnd(22)} ${diffs.length} 處差異`);
      diffs.slice(0, 8).forEach(d => console.log(d));
      if (diffs.length > 8) console.log(`  …另有 ${diffs.length - 8} 處`);
    }
  }
  server.close();
  if (save) { console.log(`\n基準已寫入 ${path.relative(ROOT, BASELINE)}/`); process.exit(0); }
  console.log(failures ? `\n❌ ${failures}/${checked} 組版面有差異` : `\n✅ ${checked} 組版面全部一致`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
