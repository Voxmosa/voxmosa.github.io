# voxmosa.github.io

Voxmosa 官方網站（靜態頁面，無需建置流程）。

| 檔案 | 內容 |
| --- | --- |
| `index.html` | 首頁 |
| `mosatalk.html` | MosaTalk：即時語音 AI 對話系統 |
| `mosaminutes.html` | MosaMinutes：地端 AI 會議記錄平台 |
| `mosascore.html` | MosaScore：地端通話質檢與購買意圖分析 |
| `support.js` | dc-runtime：解析 `<x-dc>` 模板並以 React 渲染 |
| `vendor/` | 自架的 React 18.3.1 UMD 檔（見下方） |

## 頁面結構

每個 HTML 的版面寫在 `<body>` 的 `<x-dc>` 模板裡，由 `support.js`
在瀏覽器端解析、掛載成 React 元件。因此頁面是**用戶端渲染**的：
關掉 JavaScript 或腳本載入失敗時，畫面會是空白。

`support.js` 由 `dc-runtime/src/*.ts` 產生，屬於 vendored 產物，
**不要直接編輯**；要改請回 dc-runtime 專案重新 build 後覆蓋。

### 渲染失敗的兜底

`support.js` 一執行就注入 `x-dc{display:none!important}` 把原始模板藏起來，
之後才非同步載入 React 渲染。問題是它的失敗路徑只有 `console.error` 後 rethrow，
**不會把模板顯示回來** — 所以只要渲染沒發生，使用者看到的就是全白頁。

因此每個頁面在 `support.js` 之後有一段看門狗：`load` 事件後再等 2.5 秒，
若 `#dc-root` 仍然沒有內容而 `<x-dc>` 還在，就注入
`html body x-dc{display:block!important}` 把原始模板顯示出來。
選這個選擇器是因為特異性 (0,0,3) 勝過 support.js 的 (0,0,1)，
不必依賴 `<style>` 的先後順序。

這個退化畫面是可讀的：`<x-dc>` 裡是純 HTML 加 inline style，沒有任何插值或
樣板指令，而排版所需的 CSS 就在 `<helmet>` 的 `<style>` 內。
只有靠 JS 產生的內容（例如首頁 hero 的示範動畫）會缺席 —
首頁可見文字從 8199 字降到 4055 字，但導覽、標題、產品說明、CTA 都在。

## 為什麼自架 React

React 與 ReactDOM 的 UMD 檔放在 `vendor/`，隨 repo 一起部署，
不從 unpkg 或任何公開 CDN 取得。兩個理由：

1. **消除單點故障。** 外部 CDN 一旦無法連線，整個網站就是空白頁。
2. **企業內網。** 目標客戶多半是會談地端部署的公司，這類內網常擋外部 CDN。
   官網在客戶辦公室打不開，是最不該發生的失敗情境；產品主打「跑在自己的機房」，
   官網卻依賴外部 CDN，論述上也不一致。

### 做法

`support.js` 的 `loadReactUmd()` 開頭是：

```js
if (w.React && w.ReactDOM) return Promise.resolve();
```

只要 `window.React` 與 `window.ReactDOM` 在它執行前就存在，它就不會去抓 CDN。
所以四個頁面的 `<head>` 都是這個順序，**React 必須排在 `support.js` 前面**：

```html
<script src="./vendor/react.production.min.js"></script>
<script src="./vendor/react-dom.production.min.js"></script>
<script src="./support.js"></script>
```

這樣就不必修改 `support.js` — 它裡面的 `REACT_URL` / `BABEL_URL` 常數原封不動，
之後從 dc-runtime 重新 build 覆蓋時，這個設定也不會被蓋掉。

### 升級 React 版本

```sh
V=18.3.1
curl -sfL -o vendor/react.production.min.js \
  https://unpkg.com/react@$V/umd/react.production.min.js
curl -sfL -o vendor/react-dom.production.min.js \
  https://unpkg.com/react-dom@$V/umd/react-dom.production.min.js
```

下載後建議比對雜湊，確認抓到的檔案正確 —
`support.js` 裡的 `REACT_SRI` / `REACT_DOM_SRI` 存著對應版本的 SRI 值：

```sh
openssl dgst -sha384 -binary vendor/react.production.min.js | openssl base64 -A
grep -n "REACT_SRI =\|REACT_DOM_SRI =" support.js
```

版本需與 `support.js` 內的 `REACT_URL` 一致，否則 dc-runtime 可能對不上 API。

### unpkg 仍是備援路徑

自架之後正常運作已不會碰任何公開 CDN，但 `support.js` 內建的 `REACT_URL`
常數還在：萬一 `vendor/` 的檔案取不到（例如部署漏檔），它仍會回頭去抓 unpkg。
這是刻意保留的降級行為 —— 抓得到就正常顯示，抓不到就落到上面的兜底。
若哪天要完全封死，得改 dc-runtime 或加 CSP `script-src 'self'`
（注意 runtime 用到 `new Function`，需一併評估 `unsafe-eval`）。

## 測試

```sh
node test/render-check.js          # 全部情境
node test/render-check.js blocked  # 只跑單一情境
```

零依賴，需 Node 22+ 與本機的 Chrome。它會自己起 HTTP server 並以
Chrome DevTools Protocol 驅動 headless Chrome，對四個頁面各跑四個情境：

| 情境 | 驗證的事 |
| --- | --- |
| `normal` | React 渲染成功，且完全沒有向公開 CDN 取件 |
| `blocked` | 拿不到 React 時，兜底把原始模板顯示回來（沒有兜底這裡是 0 字） |
| `nojs` | 關閉 JavaScript 仍看得到內容 |
| `slow` | 30KB/s 下看門狗不會過早開燈，最終仍正常渲染 |

判定指標是 `document.body.innerText` 的長度，因為它排除 `display:none`
的內容，恰好等於「使用者實際看得到多少字」—— 全白頁在這個指標下是 0。

## 仍然依賴的外部資源

Google Fonts（`fonts.googleapis.com` / `fonts.gstatic.com`）尚未自架。
首頁載入約 20 個 woff2 分割檔，多數來自 Noto Sans TC。
若要一併自架，建議先做字型子集化，否則完整檔太大反而更慢。

## 部署

將本資料夾內所有檔案（含 `.nojekyll` 與 `vendor/`）放到 repository 根目錄，
push 到 `main`，在 Settings → Pages 選擇 Deploy from a branch → `main` / `/ (root)`。

> `.nojekyll` 用於停用 Jekyll 處理，避免底線開頭的檔名被忽略。

## 本機預覽

直接用瀏覽器點開 HTML（`file://`）即可，`support.js` 與 `vendor/` 都是相對路徑，
不受 CORS 限制。若要模擬正式環境：

```sh
python3 -m http.server 8000
```

自架 React 之後，除了 Google Fonts 之外，頁面在完全離線的環境也能正常渲染。
