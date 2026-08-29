# voxmosa.github.io

Voxmosa 官方網站。**純靜態 HTML，沒有建置流程** —— 改完直接 push 就上線。
所有資源都在 repo 內，頁面完全不對外發出請求，關掉 JavaScript 內容也照樣完整。

| 路徑 | 內容 |
| --- | --- |
| `index.html` | 首頁（含 hero 聲波動畫與論文分類篩選）|
| `mosatalk.html` | MosaTalk：即時語音 AI 對話系統 |
| `mosaminutes.html` | MosaMinutes：地端 AI 會議記錄平台 |
| `mosascore.html` | MosaScore：地端通話質檢與購買意圖分析（含通話分析動畫）|
| `vendor/fonts/` | 子集化後自架的字型（含授權說明）|
| `test/` | 回歸測試，`test/baseline/` 為版面基準 |
| `tools/build-fonts.py` | 重新產生字型子集 |
| `tools/bake.js` | 把 `<x-dc>` 模板頁烘焙成靜態 HTML（已無頁面需要，保留備查）|
| `og.png` | 社群分享縮圖，四頁共用 |
| `favicon.svg` | 分頁圖示，取自 logo 的圓環標記 |
| `robots.txt` / `sitemap.xml` | 爬蟲規則與網站地圖；`robots.txt` 明確放行生成式搜尋的爬蟲 |
| `llms.txt` | 給 LLM 讀的網站摘要，內容全部取自站上既有文案 |
| `CNAME` / `.nojekyll` | GitHub Pages 的自訂網域與停用 Jekyll |

改動之後有兩件事要記得，兩者都有測試把關（見[測試](#測試)）：

- **改過文案** → 重跑 `tools/build-fonts.py`，否則新字缺字
- **改過 inline style 的值** → 一併更新對應的 `r-*` class 名稱

## 頁面結構

版面直接寫在 HTML 裡，用 inline style；文件結構則是語意標籤
（`header` / `nav` / `main` / `section` / `h1`–`h4` / `p` / `footer`）。
整站只有兩段 JavaScript，都是頁面自己的原生程式碼，沒有任何框架：

| 位置 | 作用 |
| --- | --- |
| `index.html` 末尾 | hero 的 44 根聲波柱動畫、逐字稿分段揭露、論文分類篩選 |
| `mosascore.html` 末尾 | 通話分析示範：每 1.5 秒揭露一句對話，並畫出分數折線 |

兩者的**靜態標記都是「動畫跑完」的狀態**，腳本只是把它倒帶重播。
因此關掉 JavaScript 時看到的是完整內容，而不是空殼 ——
`test/render-check.js` 會斷言有無 JavaScript 的可見文字量完全相同。

hero 的聲波是 `requestAnimationFrame` 驅動的**連續相位**動畫。
它曾經是 `setInterval(tick, 340)` ——一輪 40 格、每格跳一次，等於 3 fps，
所以看起來一格一格卡。現在一輪的長度仍是 13.6 秒，但相位是實數，
柱高與掃描邊界都會補間。

柱高走 `transform:scaleY()` 而不是 `height`，掃描邊界的顏色也預先算成 21 階字串：
前者讓每幀只碰合成器、不必為 44 個 flex 子元素重排版，後者省掉每幀 44 次字串組裝。
**切換到 transform 只在動畫啟動時做一次**，所以沒有 JavaScript 或
`prefers-reduced-motion` 時，畫面用的仍是標記裡原本的 `height` ——
`test/layout-check.js` 的基準因此完全不受這次改動影響。

兩段動畫都遵守 `prefers-reduced-motion`（停在完整狀態不播放），
並在分頁切到背景時暫停；hero 的聲波另外在捲出畫面時也停
（`IntersectionObserver`）。兩個暫停來源各自記狀態、兩者都放行才播 ——
否則其一的 resume 會蓋掉另一的 pause。

### 這些頁面的來歷

頁面原本是用 **Claude Design** 這個視覺編輯器產出的，之後改由直接編輯 HTML 維護。
編輯器退場後，那套用戶端渲染架構就成了為一個不存在的工作流程付的成本，
因此四個頁面都已烘焙成靜態 HTML，`support.js`（69KB）與 React（142KB）隨之移除。

知道這段來歷，才看得懂 repo 裡幾樣東西為什麼長這樣：

| 曾經有的東西 | 來歷 | 現況 |
| --- | --- | --- |
| `<x-dc>` 模板、`{{ }}` 插值、`<sc-for>` / `<sc-if>` | 編輯器的模板格式 | 已展開成靜態標記 |
| `style-hover` 屬性 | 編輯器的懸停樣式，runtime 會轉成 `.scpN:hover` 規則 | 已改寫成 `.hover-panel` / `.hover-accent` 的 CSS |
| `<script type="text/x-dc" data-props>` | 編輯器的可調參數面板定義 | 已移除，預設值直接寫進標記 |
| `support.js`、`vendor/react*.js` | dc-runtime 與 React | 已移除 |
| `#dc-root` / `.sc-host` 兩層 `<div>` | runtime 的掛載點 | **刻意保留**，見下 |

`#dc-root > .sc-host` 是 runtime 的殘留物，看起來很想刪。保留它們是因為
烘焙時 DOM 結構不變，`test/layout-check.js` 才能逐像素證明烘焙前後等價；
真要清掉是獨立的一步，清完需要重新產生版面基準。

### 響應式：`r-*` class

版面是 inline style 寫的，響應式覆蓋則集中在 `<head>` 的 `<style>` 內，
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

這批 class 是從原本的 `[style*="..."]` 屬性選擇器機械式遷移過來的。
遷移時刻意複製了當時的命中結果（包含 substring 比對造成的非預期命中），
所以版面完全沒有變化 —— 由 `test/layout-check.js` 驗證。那些非預期命中
之後才逐一處理掉，同樣是零視覺變化。

#### class 名稱與元素實際值一致

每個 class 現在只掛在 inline 值真的等於它名稱的元素上。這是可稽核的性質，
不是慣例 —— 下面這段會列出任何「一個 class 涵蓋多種 inline 值」的情況，
正常應該印出空的：

```sh
python3 - <<'EOF'
import re, pathlib, collections
PROP = {"gtc":"grid-template-columns","fs":"font-size","pad":"padding","gap":"gap",
        "mw":"max-width","brr":"border-right","brl":"border-left","display":"display"}
cover = collections.defaultdict(set)
for f in ["index.html","mosatalk.html","mosaminutes.html","mosascore.html"]:
    for m in re.finditer(r'class="([^"]*)"\s+style="([^"]*)"',
                         pathlib.Path(f).read_text(encoding="utf-8")):
        for c in m.group(1).split():
            p = PROP.get(c[2:].split("-")[0])
            v = p and re.search(re.escape(p) + r":([^;\"]*)", m.group(2))
            if v: cover[c].add(v.group(1).strip())
print({c: v for c, v in cover.items() if len(v) > 1})
EOF
```

修正的過程留了兩點經驗：

- 光看「選擇器過度命中」會得出錯誤結論。`r-pad-44px` 確實是 bug ——
  它用 shorthand `padding:30px`，連水平一起蓋掉容器慣例的 24px；
  但同樣被過度命中的 `r-pad-104px-56px` 不是，因為它的規則是 longhand
  `padding-top`/`padding-bottom`，碰不到水平。**要讀宣告內容才判斷得出來。**
- `r-pad-96px-56px` 過去沒有任何元素的值真的是 `96px 56px`，
  它命中的兩種值全都是意外 —— class 名稱在描述一個不存在的東西。

## SEO 與 AEO

四個頁面原本是**完全沒有語意標籤**的 div 湯 —— 零個 `<h1>`、零個 `<p>`、
零個地標元素。那是視覺編輯器的產物，烘焙成靜態 HTML 時沒有一併處理。
搜尋引擎與 LLM 抓取器看不出哪句是標題、哪句是版權宣告。

現在四頁都有 `header` / `nav` / `main` / `section` / `footer` 地標，
每頁**恰好一個 `<h1>`**，內文段落是 `<p>`。置換是 block→block，
配上 `<head>` 裡的 `h1,h2,h3,h4,h5,h6{margin:0}` 與 `p{margin:0}` 重置，
版面零變化 —— 所有標題與段落的 `font-size`、`font-weight` 本來就寫在 inline style 上。

結構化資料以 JSON-LD 放在每頁的 `<head>`：

| 頁面 | `@graph` 內容 |
| --- | --- |
| `index.html` | `Organization`（含獲獎、`knowsAbout`、`sameAs`）、`ItemList`、`WebSite`、`WebPage` |
| 三個子頁 | `SoftwareApplication`（含 `featureList`）、`WebSite`、`WebPage`、`BreadcrumbList` |

`Organization` 的 `@id` 是全站共用的 `https://voxmosa.com/#organization`，
子頁的產品節點用 `publisher` / `provider` 指回去，四頁因此串成同一張圖。

`robots.txt` 除了一般規則，另外逐一列出生成式搜尋的爬蟲（GPTBot、ClaudeBot、
PerplexityBot、Google-Extended 等）並明確 `Allow` —— 這個網站的內容就是要讓人
和模型都查得到、引用得到。`llms.txt` 是給 LLM 讀的摘要，**內容全部取自站上既有文案**，
沒有另外寫行銷詞；改文案時它要跟著改。

> 還沒做：站上沒有問答形態的段落。AEO 的引用率很吃「一個問句配一段短答」
> 的結構，而 `FAQPage` 結構化資料照 Google 的規範必須有對應的可見內容 ——
> 所以這件事要先有文案，不能只加標記。

## 測試

推 code 之前跑這三支，合計約 5 分 15 秒
（實測：連結不到 1 秒、內容 3:57、版面 1:19）：

```sh
node test/link-check.js     # 連結會不會 404、導覽列各頁是否一致
node test/render-check.js   # 內容有沒有渲染出來（含各種失敗情境）
node test/layout-check.js   # 版面有沒有跑掉
```

大半時間花在內容測試的「極慢網路」情境上，它刻意等滿 45 秒 ——
趕時間可以先跑版面測試，或用 `node test/render-check.js normal` 快速確認。

三支都以離開碼回報結果，失敗會列出是哪一頁、哪個元素、差在哪裡。
版面若是**刻意**改動，用 `node test/layout-check.js --save` 更新基準，
並把基準的 diff 一起提交 —— 那份 diff 就是這次視覺改動的紀錄。

### 連結

```sh
node test/link-check.js
```

檢查每個站內連結的目標檔案與錨點 id 是否真的存在，並確認四頁的導覽列項目一致。
站外連結只計數、不連線驗證，以免測試依賴外部網路。

`<a href>` 之外，`<link href>`（字型 CSS、favicon、字型 preload）也一併檢查。
這層是後來補的：preload 的檔名跟 `tools/build-fonts.py` 的產出耦合 ——
字重範圍一改檔名就變，而 preload 失效時瀏覽器不會報錯，只是白抓一個 404，
畫面照常顯示。沒有這個檢查就只能靠人眼發現。

導覽列的預期項目是**從 `index.html` 推導**的，不是寫死清單。這點是踩過坑才改的：
第一版拿四頁的共同項目當清單，等於把當下的不一致固化進測試 ——「團隊」
四頁中三頁沒有，所以它從沒進過清單，它的缺席也就永遠不可能被判為失敗。

> 這支測試是補寫的：子頁的「技術實力」「為什麼地端」曾指向
> `Voxmosa Home.dc.html#tech` —— 編輯器留下的檔名，repo 裡沒有這個檔案，
> 點下去就是 404；同時 mosascore 的導覽列漏了「技術實力」。
> 兩者渲染都正常，所以另外兩支測試完全看不到，只有實際點下去才會發現。

### 內容

```sh
node test/render-check.js         # 全部情境
node test/render-check.js nojs    # 只跑單一情境
```

零依賴，需 Node 22+ 與本機的 Chrome 或 Chromium。它會自己起 HTTP server 並以
Chrome DevTools Protocol 驅動 headless 瀏覽器，對四個頁面各跑三個情境：

| 情境 | 驗證的事 |
| --- | --- |
| `normal` | 內容顯示正常，且**完全沒有任何外部請求**（含字型）|
| `nojs` | 關閉 JavaScript 內容照樣完整 |
| `slow` | 30KB/s 慢速連線下仍然完整顯示 |

最後還有一項跨情境斷言：**每頁在有無 JavaScript 之下的可見文字量必須完全相同**。
這是整個靜態化的核心性質，也是最容易在改動中悄悄退步的一項。

正常與慢速情境下若出現任何 JS 例外即判定失敗 —— 移植動畫時踩過兩次
「頁面看起來正常、功能其實已死」，兩者都只在 console 留下一行例外。

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
寬度下跑掉了。全頁截圖供人眼比對，兩者都不進版控（見 `.gitignore`）：

- `--save` 寫入 `test/baseline/*.png` —— 基準當下的樣子
- 比對模式寫入 `test/current/*.png` —— **不會覆寫基準**，前後才能並排比對

#### 基準是綁平台的

`test/baseline/` 只在**產生它的那個作業系統 + 瀏覽器**底下有意義。
macOS 與 Linux 對文字行框高度的取整不同，同一份 HTML 在兩邊量到的
文字元素高度會差 1–2px，而且沿著頁面往下累積成大量 y 位移 ——
實測拿 macOS 產生的基準在 Linux 上跑未改動的 HEAD，5046 個元素裡 4046 個對不上。

那 4046 筆全部是垂直方向的：**x 與寬度是 0 差異，三個寬度都一樣**，
87% 的元素連高度都相同，只有小字級（9–13.5px）的文字行矮了 1–2px。
換句話說那個數字不是「版面壞了」，是「基準換平台就不能用」。

螢幕解析度**不影響**這件事 —— 量測用 `Emulation.setDeviceMetricsOverride`
把視窗強制成 375/768/1440 × 900、`deviceScaleFactor: 1`，而且跑在
headless、根本沒有實體顯示器。1080p 或 Retina 量到的完全一樣。

所以 `--save` 會把瀏覽器版本與平台寫進 `test/baseline/.env.txt`，
比對時若對不上會先印一段警告，說明底下的差異多半不是真的跑版。
沒有這個戳記，換台機器跑就會看到幾千筆假差異，然後花很久才發現不是自己改壞的。

量測前會用 `prefers-reduced-motion: reduce` 把兩段動畫凍結在完整狀態，
所以每次量到的都是同一幀。這也是動畫本身支援的行為，不是測試專用的後門。

另外保險一層：同一次載入內間隔取兩張快照，凡是自己就會變的欄位一律標成 `*`，
比對時視為萬用字元 —— 讓量測器自己找出雜訊，不必人工維護忽略清單。
遮罩只增不減，因此連續兩次 `--save` 產生的基準完全相同。

每個寬度另外檢查導覽列的每個項目是否**真的看得見**（bounding rect 落在畫面內）。
`link-check.js` 只讀原始碼，看得出連結存在、看不出它被容器裁掉或推出畫面 ——
這兩件事在使用者眼中都是「連結不見了」。

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

> 若系統沒有 `python3-venv`（Debian/Ubuntu 要另外裝套件），可以改成裝到
> 獨立目錄，不動到系統的 Python：
>
> ```sh
> python3 -m pip install --target .pylibs fonttools brotli
> PYTHONPATH=.pylibs PATH=.pylibs/bin:$PATH python3 tools/build-fonts.py
> ```

腳本會抓字型原始 TTF，子集化成站上實際用到的字元，輸出
`vendor/fonts/*.woff2` 與 `vendor/fonts/fonts.css`，頁面只 link 後者。
沒有被 `fonts.css` 引用到的舊產物會在每次執行時自動刪掉。

必須子集化的理由是 Noto Sans TC：完整檔每個字重好幾 MB，直接自架會比
Google Fonts 慢。目前六個檔案合計 340KB，其中 Noto Sans TC 一個檔就佔 307KB，
其餘五個都在 10KB 以下。

字元集會隨文案增減，目前是 1068 個字元、其中 965 個中日韓與全形符號。
這兩個數字不必手動維護 —— 執行 `tools/build-fonts.py` 時會印出當下的值。

### Noto Sans TC 用可變字型

站上的中文用到 200/300/400/500 四個字重。以前是四個靜態檔，各約 150KB，
**合計 595KB —— 佔首頁下載量的 92%**。現在改成一個可變字型檔涵蓋整段
200–500，307KB，省下 288KB。

這是這個網站唯一值得壓的東西。相較之下，把兩段 JavaScript 壓縮過只省
1.2KB（gzip 後），佔總量 0.19%，而代價是拿掉註解、外加一層建置流程 ——
所以沒有做，也不建議做。

有幾件事踩過才知道：

- 可變字型的原始檔要抓 **google/fonts 上游的完整檔**（11MB），不能走
  Google Fonts 的 CSS API —— API 送的已經照 `unicode-range` 切成上百個分片，
  而我們要自己重新子集化，需要的是未分割的完整檔。
- 先用 `fonttools varLib.instancer` 把 `wght` 軸砍到 200–500 再子集化字元。
  用不到的字重端點連帶內插資料一起省掉。
- `@font-face` 的 `format()` 要寫 **`woff2`**，不是 `woff2-variations`。
  後者是過渡期寫法，部分瀏覽器不認得，會整條規則跳過 —— 字型直接不生效，
  而且不會報錯。
- 換字型讓 **16 個元素的文字寬度差了 1px**（總量測數約 2800 個元素）。
  這是可變字型內插出來的字寬與 Google 另外建置的靜態檔本來就有的微小落差，
  不是 bug。已反映在 `test/baseline/`。

> 量測這件事本身有個陷阱：換過字型後的**第一次**執行會受瀏覽器字型快取影響，
> 可能量到舊字型的結果而假性通過。判斷字型改動的版面影響時，要新舊交替各跑
> 兩次，先確認「同字型兩次為 0 筆差異」再看跨字型的數字。

> ⚠️ **改過頁面文案後要重跑這支腳本**，否則新增的字會變成豆腐格。

字元集是從四個 HTML 的**原始碼**取聯集，不是從渲染結果 —— 這樣連只在
JavaScript 執行後才出現的字串（例如動畫裡的文字）也一定涵蓋得到。

代價是原始碼裡的中文註解與 class 名稱也會貢獻字元，讓子集略大於實際所需
（目前多出來的部分不到 1KB）。這個取捨是刻意的：漏字是使用者看得到的缺陷，
多幾 KB 不是。所以請勿為了省空間改成只掃描可見文字。

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

直接用瀏覽器點開 HTML（`file://`）即可，字型與腳本都走相對路徑，不受 CORS 限制。
若要模擬正式環境：

```sh
python3 -m http.server 8000
```

頁面在完全離線的環境也能正常顯示。

## 後續可做的事

內容面：

- **客語六腔的音檔樣本**，放在首頁研究網絡的客語卡片底下。同一句話六種腔調，
  各 10–15 秒。文字寫「六腔全數涵蓋」只是宣稱，聽到大埔腔與饒平腔的差別才是證據。
  做法上要維持站上的兩條硬性質：`<audio controls>` 不需要 JavaScript（不破壞
  有無 JS 內容相同），音檔自架於 repo 內（不對外發出請求）。六個檔案控制在 300KB 以內。
- **hero 的能力標籤換一格**（`index.html` 裡 `封閉網路可運行` 那排小字，捲動前就會被讀到）。
  現在是「封閉網路可運行／無按次 API 費用／模型自行訓練」。第三項幾乎人人都能說 ——
  微調開源模型也算自行訓練 —— 而族語 42 語、客語六腔是短期內拿不出第二家的東西。
  代價是三項現在全在講地端、很整齊，換掉一項會變成兩項講部署、一項講語言；
  也可以改成四項。要動之前先做幾版截圖比對再決定。
- **客語卡片的合作單位名稱待補**。目前該卡片只寫能力與 Gohakka 連結，
  單位名稱與對方的正式連結、用字，等對方提供後再補上。
- **首頁的 FAQ 區塊**。「Voxmosa 是什麼」「地端語音辨識要幾張 GPU」
  「台語辨識準到什麼程度」這類問句，站上目前沒有可直接被引用的短答段落。
  有了可見文案之後才能補 `FAQPage` 結構化資料。
- **`#contact` 的表單是假的** —— 整段是 `<div>` 排出來的樣子，
  「送出申請」按鈕沒有任何行為，真正能點的只有 mailto。
  SEO 把人帶進來之後會卡在這一步。要嘛接一個不需要後端的表單服務，
  要嘛把它改成誠實的 mailto 區塊。

技術面：

- **`render-check.js` 的 mosascore 有一項固定失敗**（有 JS 4608 字 / 無 JS 4627 字）。
  這不是新問題 —— 未改動的 HEAD 以完全相同的字數差失敗。原因是
  `normal` 情境等 4 秒才量測，而 mosascore 的動畫每 1.5 秒一步、已經倒帶重播，
  此時腳本把尚未揭露的分數欄 `textContent` 清成空字串，可見文字自然比靜態少。
  首頁的動畫沒這個問題，因為它用 opacity 揭露、文字一直留在 DOM 裡。
  兩個修法：把 mosascore 改成同樣用 opacity 揭露（視覺幾乎不變，欄位本來就佔位），
  或讓這項斷言在動畫凍結的前提下量測。前者比較對，也讓兩支動畫的做法一致。
- **清掉 `#dc-root` / `.sc-host` 兩層包裝**與對應的 `html,body{height:100%}` 規則。
  它們是 runtime 的殘留物，現在沒有作用。清掉會改變 DOM 結構，
  所以要一併重新產生版面基準，並用截圖比對確認外觀未變。
- **`r-*` class 與 inline style 的耦合**目前靠慣例維持（改值要改名）。
  若要根治，方向是把 inline style 的值搬進 class，元素上不再留 inline style。
  這是比烘焙更大的改動，會動到版面的組織方式。

## 授權

網站本身採 Unlicense（見 `LICENSE`），釋出至公眾領域。

`vendor/` 內的第三方資源各自沿用原授權，不受上述影響：

- 三套字型 —— SIL OFL 1.1，詳見 `vendor/fonts/LICENSE.md`
