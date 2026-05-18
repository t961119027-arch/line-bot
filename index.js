// ===== index.js (複製到 index.js) =====
require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");

const app = express();
const REGISTER_CODE = "MH0928";

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.Client(config);

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = process.env.SPREADSHEET_ID;

async function getSheet(range) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

async function appendSheet(range, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

function flexCard(title, body) {
  const now = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei"
  });

  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#111111",
        contents: [
          {
            type: "text",
            text: title,
            weight: "bold",
            size: "xl",
            color: "#D4AF37"
          },
          {
            type: "text",
            text: now,
            size: "xs",
            color: "#888888",
            margin: "sm"
          },
          {
            type: "separator",
            margin: "md",
            color: "#444444"
          },
          {
            type: "text",
            text: body,
            wrap: true,
            margin: "md",
            color: "#FFFFFF"
          }
        ]
      }
    }
  };
}
async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") return null;

  const msg = event.message.text.trim();

  if (msg === "/選單") {
    return client.replyMessage(event.replyToken, flexCard("智能浣熊 M", "輸入 /功能 查看可用功能"));
  }

  if (msg === "/功能") {
    return client.replyMessage(event.replyToken, flexCard("功能", "/註冊\n/價格表\n/設定價格\n/menu"));
  }

  if (msg === "/狀態") {
  return client.replyMessage(
    event.replyToken,
    flexCard("系統狀態", "智能浣熊 M 正常運作")
  );
}

return null;
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("ERP Bot running");
});
