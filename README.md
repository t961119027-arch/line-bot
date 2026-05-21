# LINE 代儲訂單機器人

這是接到舊版 Google Sheets LINE 機器人上的代儲訂單流程：建立訂單、付款回報、查詢狀態、管理員審核。

## 功能

- 使用者傳送「選單」開啟服務選單
- 使用者建立代儲訂單
- 使用者傳送「付款回報 末五碼或備註」
- 管理員收到新訂單與付款回報通知
- 管理員可用文字指令核准、完成或退回訂單
- 訂單寫入 Google Sheet 的 `TopupOrders` 工作表

## 開始使用

1. 安裝 Node.js 20 以上版本。
2. 到 LINE Developers 建立 Messaging API Channel。
3. 複製環境設定：

```powershell
Copy-Item .env.example .env
```

4. 編輯 `.env`：

```text
CHANNEL_ACCESS_TOKEN=你的 Channel access token
CHANNEL_SECRET=你的 Channel secret
GOOGLE_CLIENT_EMAIL=你的 Google service account email
GOOGLE_PRIVATE_KEY=你的 Google private key
SPREADSHEET_ID=你的 Google Sheet ID
ADMIN_LINE_USER_IDS=管理員的 LINE userId
PORT=10000
```

5. 安裝套件並啟動：

```powershell
npm install
npm run init:sheets
npm run dev
```

6. 用 ngrok 或正式主機把 `/webhook` 開給 LINE：

```text
https://你的網域/webhook
```

## 使用指令

使用者：

```text
代儲
代儲品項
下單 遊戲點數 100 玩家ID: abc123
付款回報 TXXXXXXXX 12345
查詢訂單
```

管理員：

```text
設定後台群組
後台狀態
庫存
入庫 傳說點券 300 ABCD-1234
待處理訂單
核准 TXXXXXXXX
完成 TXXXXXXXX
退回 TXXXXXXXX
```

## 後台群組與自動出貨

1. 把機器人加入你的後台 LINE 群組。
2. 在後台群組傳「設定後台群組」。
3. 用「入庫 商品 金額 內容」放入點數或序號。
4. 客人下單後，後台群組會收到新訂單。
5. 管理員傳「核准 TXXXXXXXX」後，機器人會找同商品、同金額的可用庫存，自動私訊給客人並把訂單改成完成。

如果沒有相同商品與金額的庫存，訂單會先核准，後台群組會收到缺貨提醒。

## Google Sheet 欄位

可以執行 `npm run init:sheets` 自動建立/補齊以下工作表：

```text
TopupOrders, TopupInventory, BotConfig, Permissions, GroupConfig, AuditLog, Pricing, GroupLedger, Payroll, PersonalFinance, CompanyFinance
```

`TopupOrders` 第一列會是：

```text
訂單編號,建立時間,使用者ID,群組ID,品項,金額,備註,狀態,付款備註,更新時間
```

## 上線前建議

- 將 `orders.json` 改成正式資料庫，例如 PostgreSQL、MySQL、Firestore。
- 接金流時只使用合法金流服務，不要要求使用者提供帳號密碼。
- 加上商品後台、付款憑證圖片上傳、黑名單、風控與操作紀錄。
- 檢查你代儲的商品或遊戲是否允許第三方儲值服務。
