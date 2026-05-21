require("dotenv").config();
const { google } = require("googleapis");

const requiredEnv = [
  "GOOGLE_CLIENT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "SPREADSHEET_ID"
];

const missingEnv = requiredEnv.filter(name => !process.env[name]);

if (missingEnv.length) {
  throw new Error(`Missing required env: ${missingEnv.join(", ")}`);
}

const spreadsheetId = process.env.SPREADSHEET_ID;

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({
  version: "v4",
  auth
});

const sheetDefinitions = [
  {
    title: "TopupOrders",
    range: "TopupOrders!A1:J1",
    headers: [
      "訂單編號",
      "建立時間",
      "使用者ID",
      "群組ID",
      "品項",
      "金額",
      "備註",
      "狀態",
      "付款備註",
      "更新時間"
    ]
  },
  {
    title: "TopupInventory",
    range: "TopupInventory!A1:G1",
    headers: ["建立時間", "商品", "金額", "內容", "狀態", "訂單編號", "更新時間"]
  },
  {
    title: "BotConfig",
    range: "BotConfig!A1:B1",
    headers: ["設定", "值"]
  },
  {
    title: "TopupInstructions",
    range: "TopupInstructions!A1:D1",
    headers: ["商品", "金額", "說明", "更新時間"]
  },
  {
    title: "TopupPayments",
    range: "TopupPayments!A1:F1",
    headers: ["名稱", "帳號", "戶名", "備註", "狀態", "更新時間"]
  },
  {
    title: "Permissions",
    range: "Permissions!A1:D1",
    headers: ["群組ID", "使用者ID", "角色", "名稱"]
  },
  {
    title: "GroupConfig",
    range: "GroupConfig!A1:C1",
    headers: ["群組ID", "A名稱", "B名稱"]
  },
  {
    title: "AuditLog",
    range: "AuditLog!A1:D1",
    headers: ["時間", "群組ID", "操作者", "動作"]
  },
  {
    title: "Pricing",
    range: "Pricing!A1:C1",
    headers: ["品項", "金額", "佣金"]
  },
  {
    title: "GroupLedger",
    range: "GroupLedger!A1:H1",
    headers: ["時間", "群組ID", "A名稱", "B名稱", "算式", "本次金額", "餘額", "備註"]
  },
  {
    title: "Payroll",
    range: "Payroll!A1:E1",
    headers: ["時間", "名稱", "項目", "備註", "金額"]
  },
  {
    title: "PersonalFinance",
    range: "PersonalFinance!A1:E1",
    headers: ["時間", "名稱", "類型", "項目", "金額"]
  },
  {
    title: "CompanyFinance",
    range: "CompanyFinance!A1:E1",
    headers: ["時間", "名稱", "類型", "項目", "金額"]
  }
];

async function getExistingSheetTitles() {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title"
  });

  return new Set((res.data.sheets || []).map(sheet => sheet.properties.title));
}

async function createMissingSheets(existingTitles) {
  const requests = sheetDefinitions
    .filter(sheet => !existingTitles.has(sheet.title))
    .map(sheet => ({
      addSheet: {
        properties: {
          title: sheet.title
        }
      }
    }));

  if (!requests.length) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests }
  });
}

async function ensureHeaders() {
  for (const sheet of sheetDefinitions) {
    const current = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheet.range
    });

    const firstRow = current.data.values && current.data.values[0];

    if (!firstRow || firstRow.join("|") !== sheet.headers.join("|")) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: sheet.range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [sheet.headers]
        }
      });
    }
  }
}

async function main() {
  const existingTitles = await getExistingSheetTitles();
  await createMissingSheets(existingTitles);
  await ensureHeaders();
  console.log("Google Sheet 初始化完成");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
