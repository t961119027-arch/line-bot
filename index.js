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

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({
  version: "v4",
  auth,
});

const spreadsheetId = process.env.SPREADSHEET_ID;
const REGISTER_CODE = "MH0928";

// 結算暫存
const activeSettlement = new Map();

app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function getSheet(range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

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

async function updateSheet(range, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

async function getUser(userId) {
  const users = await getSheet("Users!A:C");
  return users.find((r) => r[0] === userId);
}

async function getPricing() {
  return await getSheet("Pricing!A:C");
}

function reply(token, text) {
  return client.replyMessage(token, {
    type: "text",
    text,
  });
}

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const msg = event.message.text.trim();
  const userId = event.source.userId;

  // 註冊
  if (msg.startsWith("/註冊 ")) {
    const parts = msg.split(" ");

    if (parts.length !== 4) {
      return reply(
        event.replyToken,
        "格式：/註冊 MH0928 名稱 admin|manager"
      );
    }

    const code = parts[1];
    const name = parts[2];
    const role = parts[3];

    if (code !== REGISTER_CODE) {
      return reply(event.replyToken, "註冊碼錯誤");
    }

    if (!["admin", "manager"].includes(role)) {
      return reply(event.replyToken, "身份只能 admin 或 manager");
    }

    const users = await getSheet("Users!A:C");
    const exists = users.find((r) => r[0] === userId);

    if (exists) {
      return reply(event.replyToken, "你已經註冊過");
    }

    await appendSheet("Users!A:C", [[userId, name, role]]);

    return reply(
      event.replyToken,
      `註冊成功\n名稱：${name}\n身份：${role}`
    );
  }

  // 權限檢查
  const user = await getUser(userId);

  if (!user) {
    return reply(event.replyToken, "你沒有權限使用，請先註冊");
  }

  const role = user[2];

  // 價格表
  if (msg === "/價格表") {
    const pricing = await getPricing();

    if (!pricing.length) {
      return reply(event.replyToken, "價格表沒有資料");
    }

    let text = "【價格表】\n\n";

    pricing.forEach((r) => {
      text += `${r[0]} ${r[1]} → ${r[2]}\n`;
    });

    return reply(event.replyToken, text);
  }

  // 設定價格
  if (msg.startsWith("/設定價格 ")) {
    if (role !== "admin") {
      return reply(event.replyToken, "只有 admin 可設定價格");
    }

    const parts = msg.split(" ");

    if (parts.length !== 4) {
      return reply(
        event.replyToken,
        "格式：/設定價格 商品 售價 抽成"
      );
    }

    const product = parts[1];
    const price = Number(parts[2]);
    const commission = Number(parts[3]);

    if (isNaN(price) || isNaN(commission)) {
      return reply(event.replyToken, "數字格式錯誤");
    }

    await appendSheet("Pricing!A:C", [[product, price, commission]]);

    return reply(
      event.replyToken,
      `設定成功\n${product} ${price} → ${commission}`
    );
  }

  // 開始結算
  if (msg.startsWith("/結算 ")) {
    const employee = msg.replace("/結算 ", "").trim();

    if (!employee) {
      return reply(event.replyToken, "格式：/結算 員工名稱");
    }

    activeSettlement.set(userId, employee);

    return reply(
      event.replyToken,
      `已進入 ${employee} 結算模式

請貼多筆：
1390 2900049
750 2900050

輸入 /取消 離開`
    );
  }

  // 取消
  if (msg === "/取消") {
    activeSettlement.delete(userId);
    return reply(event.replyToken, "已取消");
  }

  // 管理總表
  if (msg === "/管理總表") {
    if (role !== "admin") {
      return reply(event.replyToken, "只有 admin 可使用");
    }

    const rows = await getSheet("Sheet1!A:G");

    let totalRevenue = 0;
    let totalCommission = 0;
    const employeeMap = {};

    rows.slice(1).forEach((r) => {
      const employee = r[1];
      const revenue = Number(r[3]) || 0;
      const commission = Number(r[4]) || 0;

      totalRevenue += revenue;
      totalCommission += commission;

      if (!employeeMap[employee]) {
        employeeMap[employee] = 0;
      }

      employeeMap[employee] += commission;
    });

    let text = "【管理總表】\n\n";

    Object.keys(employeeMap).forEach((name) => {
      text += `${name}：${employeeMap[name]}\n`;
    });

    text += `\n總營收：${totalRevenue}`;
    text += `\n總抽成：${totalCommission}`;

    return reply(event.replyToken, text);
  }

  // 結算模式
  if (activeSettlement.has(userId)) {
    const employee = activeSettlement.get(userId);
    const pricing = await getPricing();
    const existingOrders = await getSheet("Sheet1!G:G");

    const existingSet = new Set(existingOrders.flat());

    const lines = msg
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean);

    let totalCommission = 0;
    let totalRevenue = 0;
    let successCount = 0;

    const duplicateOrders = [];
    const unknownPrices = [];
    const detail = [];
    const rows = [];

    for (const line of lines) {
      const parts = line.split(/\s+/);

      if (parts.length < 2) continue;

      const price = Number(parts[0]);
      const orderId = parts[1];

      if (!price || !orderId) continue;

      if (existingSet.has(orderId)) {
        duplicateOrders.push(orderId);
        continue;
      }

      const matched = pricing.find((r) => Number(r[1]) === price);

      if (!matched) {
        unknownPrices.push(price);
        continue;
      }

      const product = matched[0];
      const commission = Number(matched[2]);

      totalCommission += commission;
      totalRevenue += price;
      successCount++;

      detail.push(`${price} → +${commission}`);

      rows.push([
        new Date().toLocaleString("zh-TW", {
          timeZone: "Asia/Taipei",
        }),
        employee,
        product,
        price,
        commission,
        price - commission,
        orderId,
      ]);
    }

    if (rows.length) {
      await appendSheet("Sheet1!A:G", rows);
    }

    let text =
      `【${employee} 結算完成】\n\n` +
      detail.join("\n") +
      `\n\n共 ${successCount} 筆` +
      `\n總營收：${totalRevenue}` +
      `\n總抽成：${totalCommission}`;

    if (duplicateOrders.length) {
      text += `\n\n重複訂單：\n${duplicateOrders.join("\n")}`;
    }

    if (unknownPrices.length) {
      text += `\n\n找不到價格：\n${unknownPrices.join("\n")}`;
    }

    activeSettlement.delete(userId);

    return reply(event.replyToken, text);
  }

  return reply(
    event.replyToken,
    "可用指令：\n/註冊\n/結算\n/價格表\n/管理總表\n/取消"
  );
}

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Settlement Bot running");
});
