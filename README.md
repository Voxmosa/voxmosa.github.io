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
| `CNAME` / `.nojekyll` | GitHub Pages 的自訂網域與停用 Jekyll |

改動之後有兩件事要記得，兩者都有測試把關（見[測試](#測試)）：

- **改過文案** → 重跑 `tools/build-fonts.py`，否則新字缺字
- **改過 inline style 的值** → 一併更新對應的 `r-*` class 名稱

## 頁面結構

版面直接寫在 HTML 裡，用 inline style。整站只有兩段 JavaScript，
都是頁面自己的原生程式碼，沒有任何框架：

| 位置 | 作用 |
| --- | --- |
| `index.html` 末尾 | hero 的 44 根聲波柱動畫、逐字稿分段揭露、論文分類篩選 |
| `mosascore.html` 末尾 | 通話分析示範：每 1.5 秒揭露一句對話，並畫出分數折線 |

兩者的**靜態標記都是「動畫跑完」的狀態**，腳本只是把它倒帶重播。
因此關掉 JavaScript 時看到的是完整內容，而不是空殼 ——
`test/render-check.js` 會斷言有無 JavaScript 的可見文字量完全相同。

兩段動畫都遵守 `prefers-reduced-motion`（停在完整狀態不播放），
並在分頁切到背景時暫停。

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

零依賴，需 Node 22+ 與本機的 Chrome。它會自己起 HTTP server 並以
Chrome DevTools Protocol 驅動 headless Chrome，對四個頁面各跑三個情境：

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

腳本會抓 Google Fonts 的原始 TTF，子集化成站上實際用到的字元，輸出
`vendor/fonts/*.woff2` 與 `vendor/fonts/fonts.css`，頁面只 link 後者。

必須子集化的理由是 Noto Sans TC：完整檔每個字重好幾 MB，直接自架會比
Google Fonts 慢。取站上實際用到的字元之後，九個字重合計 628KB
（Noto Sans TC 四個字重各約 150KB，其餘五個都在 10KB 以下）。

字元集會隨文案增減，目前是 1053 個字元、其中 951 個中日韓與全形符號。
這兩個數字不必手動維護 —— 執行 `tools/build-fonts.py` 時會印出當下的值。

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
- **hero 的能力標籤換一格**。現在是「封閉網路可運行／無按次 API 費用／模型自行訓練」，
  而族語 42 語、客語六腔的涵蓋度比第三項更難被複製。
- **客語卡片的合作單位名稱待補**。目前該卡片只寫能力與 Gohakka 連結，
  單位名稱與對方的正式連結、用字，等對方提供後再補上。

技術面：

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
