# LINE 工作室帳務 / 代儲訂單機器人

這是接到舊版 Google Sheets LINE 機器人上的工作室帳務系統。  
目前先取消 8591 掛勾，保留原本 LINE + Google Sheets 架構，並強化價格表、A/B/C 三位員工抽成、每日薪水查詢與代儲訂單流程。

## 功能

- 使用者傳送「選單」開啟服務選單
- 使用者建立代儲訂單
- 使用者傳送「付款回報 末五碼或備註」
- 管理員收到新訂單與付款回報通知
- 管理員可用文字指令核准、完成或退回訂單
- 訂單寫入 Google Sheet 的 `TopupOrders` 工作表
- 價格表可設定 A/B/C 三位員工不同抽成
- 員工完成一筆可直接輸入 `A 300`、`B 300*2 備註`
- 可查每天每位員工抽成薪水

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

### 抽成與員工

先設定員工：

```text
/設定員工 A 小明
/設定員工 B 小美
/設定員工 C 小王
```

也可以一次設定：

```text
/設定 小明 小美 小王
```

設定價格與抽成：

```text
/設定價格 商品 售價 A抽成 B抽成 C抽成
/設定價格 傳說點券 300 30 25 20
```

舊格式仍可用：

```text
/設定價格 傳說點券 300 30
```

這會把 A/B/C 抽成都設成 30。

員工完成訂單後，在 LINE 直接輸入：

```text
/員工 A 售價 抽成 8591編號
/員工 A 1290 90 4554566
```

這個格式會直接寫入薪水，並用 `8591編號` 防止重複登記。同一個編號再輸入一次，不會重複計算。

也可以一次貼很多筆：

```text
/員工 A
1290 90 4546566
1290 90 4546567
2680 180 4546568
```

每一行格式都是：

```text
售價 抽成 8591編號
```

機器人會逐筆登記，重複的 8591 編號會跳過。

舊格式仍可用：

```text
A 300
B 300*2
C 500 客人加急
/抽成 A 300 2 備註
```

舊格式會自動用 `Pricing` 工作表的金額找到品項，並依 A/B/C 個別抽成寫入 `Payroll`。

查詢每天抽成：

```text
/今日抽成
/昨日抽成
/抽成查詢 2026-06-15
/抽成查詢 A 2026-06-15
/薪水
/薪水 2026-06-15
/薪水 A 2026-06-15
/薪資 A
/薪資排行
```

`/薪水` 會回覆每天每位員工金額，並產生 Excel 下載連結。若 Render 網址不是預設值，請在環境變數設定：

```text
PUBLIC_BASE_URL=https://你的-render網址
```

### 代儲訂單

使用者：

```text
代儲
付款方式
代儲品項
下單 遊戲點數 100 玩家ID: abc123
付款回報 TXXXXXXXX 12345
查詢訂單
```

管理員：

```text
/選單
/選單2
/員工
/價格表
/今日抽成
/抽成查詢 2026-06-15
設定後台群組
後台狀態
設定付款 台新銀行 123456789 王小明 轉帳後請回傳末五碼
付款清單
刪除付款 台新銀行
庫存
設定說明 傳說點券 300 請到遊戲內兌換中心輸入序號
入庫 傳說點券 300 ABCD-1234
待處理訂單
核准 TXXXXXXXX
完成 TXXXXXXXX
退回 TXXXXXXXX
```

## 後台群組與自動出貨

1. 把機器人加入你的後台 LINE 群組。
2. 在後台群組傳「設定後台群組」。
3. 用「設定說明 商品 金額 說明文案」設定固定使用說明。
4. 用「入庫 商品 金額 序號」放入點數序號。
5. 客人下單後，後台群組會收到新訂單。
6. 管理員傳「核准 TXXXXXXXX」後，機器人會找同商品、同金額的可用庫存，自動私訊「固定說明 + 序號」給客人並把訂單改成完成。

如果沒有相同商品與金額的庫存，訂單會先核准，後台群組會收到缺貨提醒。

## Google Sheet 欄位

可以執行 `npm run init:sheets` 自動建立/補齊以下工作表：

```text
TopupOrders, TopupInventory, TopupInstructions, TopupPayments, BotConfig, Permissions, GroupConfig, AuditLog, Pricing, GroupLedger, Payroll, PersonalFinance, CompanyFinance
```

`GroupConfig` 第一列：

```text
群組ID,A名稱,B名稱,C名稱
```

`Pricing` 第一列：

```text
品項,金額,A抽成,B抽成,C抽成,備註
```

你可以照這個格式填：

```text
傳說點券,300,30,25,20,活動價
傳說點券,500,50,45,40,一般價
```

`Payroll` 第一列：

```text
時間,日期,員工代號,員工名稱,品項,售價,抽成,數量,備註,8591編號
```

系統會自動寫入，不需要手動填。你要看每天薪水時用 `/今日抽成` 或 `/抽成查詢 2026-06-15`。

`TopupOrders` 第一列會是：

```text
訂單編號,建立時間,使用者ID,群組ID,品項,金額,備註,狀態,付款備註,更新時間
```

## UI 使用提示

每個主要 LINE UI 都會附上可用指令：

- `/選單`：顯示帳務、價格表、薪水報表、個人財務，並提示 `/員工 A 1290 90 4554566` 與 `/薪水`。
- `/選單2`：顯示員工設定、薪資排行、公司金流。
- `/員工`：顯示 A/B/C 員工設定與抽成登記格式。
- `/價格表`：顯示價格與 A/B/C 抽成欄位格式。
- `/薪水`：顯示當日 A/B/C 各自薪水，並產生 Excel 報表連結。
- `/今日抽成`：顯示當日 A/B/C 各自薪水與明細。

## 上線前建議

- 接金流時只使用合法金流服務，不要要求使用者提供帳號密碼。
- 加上商品後台、付款憑證圖片上傳、黑名單、風控與操作紀錄。
- 檢查你代儲的商品或遊戲是否允許第三方儲值服務。
