# voxmosa.github.io

Voxmosa 官方網站（靜態頁面，無需建置流程）。

| 檔案 | 內容 |
| --- | --- |
| `index.html` | 首頁 |
| `mosatalk.html` | MosaTalk：即時語音 AI 對話系統 |
| `mosaminutes.html` | MosaMinutes：地端 AI 會議記錄平台 |
| `mosascore.html` | MosaScore：地端通話質檢與購買意圖分析 |

## 部署

將本資料夾內所有檔案（含 `.nojekyll`）放到 repository 根目錄，push 到 `main`，
在 Settings → Pages 選擇 Deploy from a branch → `main` / `/ (root)`。

每個 HTML 皆為單一自含檔案（字型、腳本、樣式全部內嵌），可離線開啟，
彼此以相對路徑互連，不依賴任何外部資源或 CDN。

> `.nojekyll` 用於停用 Jekyll 處理，避免底線開頭的檔名被忽略。
