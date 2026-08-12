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

### 響應式：`r-*` class

版面是 inline style 寫的，響應式覆蓋則集中在 `<helmet>` 的 `<style>` 內，
以 `r-<屬性>-<值>` 命名的 class 掛勾：

```html
<div class="r-gtc-repeat-4-1fr r-gap-72px" style="display:grid;grid-template-columns:repeat(4, 1fr);gap:72px">
```

```css
@media (max-width:1080px){
  .r-gtc-repeat-4-1fr{grid-template-columns:1fr 1fr!important}
  .r-gap-72px{gap:44px!important}
}
```

class 名稱編碼的是「這個元素的 inline style 帶有這個值」，所以它與 inline
style 是**靠慣例耦合、而非機制保證**：改了 inline 的值，要一併改 class 名稱，
否則覆蓋規則會停留在舊值上。好處是這層耦合現在看得見也 grep 得到。

這批 class 是從原本的 `[style*="..."]` 屬性選擇器機械式遷移過來的，
遷移時刻意複製了當時的命中結果（包含下面那些非預期命中），
所以四個頁面三種寬度的版面完全沒有變化 —— 由 `test/layout-check.js` 驗證。

#### 非預期命中

原本的 substring 比對會命中比預期更長的值，遷移時原樣保留了這些行為。
逐一量測之後，只有一個造成實際問題，已修掉：

| class | 意外命中 | 量測結果 |
| --- | --- | --- |
| `r-pad-44px` | `padding: 44px 56px` | **曾是問題，已修。** shorthand `padding:30px` 連水平一起蓋掉，把容器慣例的 24px 變成 30px。現在改掛 `r-pad-44px-56px`，只調垂直 |
| `r-pad-104px-56px` | `padding: 104px 56px 116px` | 不是問題。規則用的是 longhand `padding-top`/`padding-bottom`，水平不受影響，第三個值變成 64px 正是規則本意 |
| `r-pad-96px-56px` | `padding: 96px 56px 100px` | 同上 |
| `r-gtc-1fr-1fr` | `grid-template-columns: 1fr 1fr 1fr` | 不是問題。900px 以下兩者都塌成單欄，結果相同 |

> 判斷這四項時，光看「選擇器過度命中」會得出錯誤結論 ——
> 必須一併讀規則的宣告內容（shorthand 還是 longhand）與同一個中斷點裡
> 其他規則的先後順序。前三項我一開始都判斷錯，是實際量測 computed style
> 才看清楚的。

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

### 版面

```sh
node test/layout-check.js          # 與基準比對
node test/layout-check.js --save   # 重新產生基準
```

在 375 / 768 / 1440 三種寬度下走訪整個 DOM，記錄每個元素的 bounding rect
與 `display`、`grid-template-columns`、`gap`、`font-size`、`padding`、`max-width`。
元素以「DOM 位置路徑」識別而非選擇器 —— 改動 `style` 屬性或加 class 都不影響對齊，
只有真的動了 DOM 結構才會對不上（那會被明確報成結構差異）。

基準是 `test/baseline/*.txt`，純文字所以 `git diff` 直接看得出哪個元素在哪個
寬度下跑掉了。同目錄的 `.png` 全頁截圖供人眼比對，不進版控（見 `.gitignore`）。

hero 有一組 JS 驅動的聲波動畫，CSS 停不掉。量測器的做法是在同一次載入內間隔
取兩張快照，凡是自己就會變的欄位一律標成 `*`，比對時視為萬用字元 ——
讓它自己找出雜訊，不必人工維護「請忽略這些元素」的清單。

> 這張安全網驗證過兩件事：連續兩次比對完全一致（可重現），
> 以及故意把 `[style*="grid-template-columns: 1fr 1fr"]` 改成對不上的字串後，
> 375 與 768 立刻報出 `grid-template-columns 339px → 159.5px 159.5px`
> 而 1440 保持通過（抓得到真實跑版）。

## 字型

字型也是自架的，所以整個網站**沒有任何外部請求**（`test/render-check.js`
的 `normal` 情境會驗證這件事）。

```sh
python3 -m venv .venv && .venv/bin/pip install fonttools brotli
.venv/bin/python tools/build-fonts.py
```

腳本會抓 Google Fonts 的原始 TTF，子集化成站上實際用到的字元，輸出
`vendor/fonts/*.woff2` 與 `vendor/fonts/fonts.css`，頁面只 link 後者。

必須子集化的理由是 Noto Sans TC：完整檔每個字重好幾 MB，直接自架會比
Google Fonts 慢。取站上實際用到的約 1000 個字元（978 個是中日韓字）之後，
九個字重合計約 600KB。

> ⚠️ **改過頁面文案後要重跑這支腳本**，否則新增的字會變成豆腐格。
> 字元集是從四個 HTML 的原始碼取聯集，所以連 hero 動畫那些寫在
> `data-dc-script` 裡的字串也涵蓋在內。

### 自架後有 4 個符號改變了外觀

`–` `—` `…` `≈` 這四個符號不在 Google 實際送出的 latin 子集範圍內，
過去是掉到系統字型去畫的；自架之後改由品牌字型自己畫。

這是刻意接受的變化，因為它比較好看：品牌字型的破折號與刪節號會跟隨
字重（頁面多處用 300），系統字型畫出來明顯偏粗偏寬，與周圍細體文字不搭。
代價是版面有 1–4px 的位移，所以 `test/baseline/` 已隨之更新。
若想回到原本的外觀，在 `tools/build-fonts.py` 的字元集裡排除這四個碼位即可。

字型授權見 `vendor/fonts/LICENSE.md`（三套皆為 SIL OFL 1.1，允許子集化與散布）。

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
