require("dotenv").config();

const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");

const app = express();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

// Google Sheet
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const spreadsheetId = process.env.SPREADSHEET_ID;

// 管理員 ID（之後再填）
const ADMIN_IDS = [];

app.post("/webhook", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const msg = event.message.text.trim();

  // ===== 抽成 =====
  if (msg.startsWith("/抽成")) {
    const args = msg.split(" ");

    if (args.length < 5) {
      return reply(event.replyToken, "格式：/抽成 員工 商品 售價 分潤");
    }

    const employee = args[1];
    const product = args[2];
    const price = Number(args[3]);
    const commission = Number(args[4]);

    if (isNaN(price) || isNaN(commission)) {
      return reply(event.replyToken, "數字格式錯誤");
    }

    const company = price - commission;
    const time = new Date().toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
    });

    const orderId = "#" + Math.floor(Math.random() * 999999);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A:G",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[time, employee, product, price, commission, company, orderId]],
      },
    });

    return reply(
      event.replyToken,
      `【新增成功】\n\n員工：${employee}\n商品：${product}\n售價：${price}\n抽成：${commission}\n公司實收：${company}\n\n訂單：${orderId}`
    );
  }

  // ===== 今日 =====
  if (msg.startsWith("/今日")) {
    const args = msg.split(" ");
    const employee = args[1];

    const rows = await getSheet();

    const today = new Date().toLocaleDateString("zh-TW", {
      timeZone: "Asia/Taipei",
    });

    let total = 0;
    let commission = 0;
    let count = 0;

    rows.forEach((r) => {
      if (r[1] === employee && r[0]?.includes(today)) {
        total += Number(r[3]);
        commission += Number(r[4]);
        count++;
      }
    });

    return reply(
      event.replyToken,
      `【${employee} 今日】\n訂單：${count}\n營收：${total}\n抽成：${commission}`
    );
  }

  // ===== 總表 =====
  if (msg === "/總表") {
    if (!ADMIN_IDS.includes(event.source.userId)) {
      return reply(event.replyToken, "無權限");
    }

    const rows = await getSheet();

    let map = {};
    let total = 0;
    let com = 0;

    rows.forEach((r) => {
      const emp = r[1];
      const price = Number(r[3]);
      const commission = Number(r[4]);

      map[emp] = (map[emp] || 0) + commission;
      total += price;
      com += commission;
    });

    let text = "【總表】\n\n";

    Object.keys(map).forEach((k) => {
      text += `${k}：${map[k]}\n`;
    });

    text += `\n總營收：${total}\n總抽成：${com}`;

    return reply(event.replyToken, text);
  }

  return reply(event.replyToken, "未知指令");
}

async function getSheet() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Sheet1!A2:G",
  });

  return res.data.values || [];
}

function reply(token, text) {
  return client.replyMessage(token, {
    type: "text",
    text,
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot running"));
