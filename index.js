require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");

const app = express();
const REGISTER_CODE = "MH0928";
const activeSettlement = new Map();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};

const client = new line.Client(config);

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

const spreadsheetId = process.env.SPREADSHEET_ID;

async function getSheet(range) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });
  return res.data.values || [];
}

async function appendSheet(range, values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}

async function updateSheet(range, values) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values }
  });
}

async function getUser(userId) {
  const users = await getSheet("Users!A:C");
  return {
    users,
    row: users.find(r => r[0] === userId)
  };
}

function nowTW() {
  return new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei"
  });
}

function flexCard(title, body, buttons = []) {
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
            text: nowTW(),
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
      },
      footer: buttons.length
        ? {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: buttons.map(btn => ({
              type: "button",
              style: "primary",
              color: "#D4AF37",
              action: {
                type: "message",
                label: btn.label,
                text: btn.text
              }
            }))
          }
        : undefined
    }
  };
}

function helpText() {
  return `
/註冊 密碼 名稱 admin|manager
/選單
/功能
/狀態
/結算 員工名稱
/查詢 名稱
/價格表
/設定價格 商品 售價 抽成
/管理總表

智慧帳務:
MING -4500
MING +2000
`;
}app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (err) {
    console.error(err);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const msg = event.message.text.trim();
  const userId = event.source.userId;

  if (msg.startsWith("/註冊 ")) {
    const parts = msg.split(" ");

    if (parts.length !== 4) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "格式：/註冊 密碼 名稱 admin|manager"
      });
    }

    const code = parts[1];
    const name = parts[2];
    const role = parts[3];

    if (code !== REGISTER_CODE) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "註冊碼錯誤"
      });
    }

    if (!["admin", "manager"].includes(role)) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "身份只能 admin 或 manager"
      });
    }

    const existing = await getUser(userId);

    if (existing.row) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "你已經註冊過"
      });
    }

    await appendSheet("Users!A:C", [[userId, name, role]]);

    return client.replyMessage(
      event.replyToken,
      flexCard("註冊成功", `${name} (${role})`)
    );
  }

  if (msg === "/功能") {
    return client.replyMessage(
      event.replyToken,
      flexCard("功能列表", helpText())
    );
  }

  if (msg === "/選單") {
  return client.replyMessage(
    event.replyToken,
    flexCard("智能浣熊 M", "主選單", [
      { label: "🧾 結算", text: "/結算 " },
      { label: "🔍 查詢", text: "/查詢 " },
      { label: "💰 價格表", text: "/價格表" },
      { label: "➡ 更多", text: "/選單2" }
    ])
  );
}
  if (msg === "/選單2") {
  return client.replyMessage(
    event.replyToken,
    flexCard("智能浣熊 M", "管理功能", [
      { label: "⚙ 設定價格", text: "/設定價格 " },
      { label: "📊 管理總表", text: "/管理總表" },
      { label: "💻 狀態", text: "/狀態" },
      { label: "⬅ 返回", text: "/選單" }
    ])
  );
}

  if (msg === "/狀態") {
    return client.replyMessage(
      event.replyToken,
      flexCard("系統狀態", "智能浣熊 M 正常運作")
    );
  }

  const { users, row: user } = await getUser(userId);

  if (!user) {
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: "請先註冊"
    });
  }

  const actorName = user[1];
  const role = user[2];

  if (msg.startsWith("/removeadmin ")) {
    if (role !== "admin") {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "無權限"
      });
    }

    const targetName = msg.replace("/removeadmin ", "").trim();

    const updated = users.map(r => {
      if (r[1] === targetName && r[2] === "admin") {
        return [r[0], r[1], "manager"];
      }
      return r;
    });

    await updateSheet("Users!A:C", updated);

    return client.replyMessage(
      event.replyToken,
      flexCard("權限更新", `${targetName} 已降為 manager`)
    );
  }

  if (msg === "/價格表") {
    const pricing = await getSheet("Pricing!A:C");

    const text = pricing.length
      ? pricing.map(r => `${r[0]} ${r[1]} → ${r[2]}`).join("\n")
      : "沒有資料";

    return client.replyMessage(
      event.replyToken,
      flexCard("價格表", text)
    );
  }

  if (msg.startsWith("/設定價格 ")) {
    if (role !== "admin") {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "只有 admin 可設定"
      });
    }

    const parts = msg.split(" ");

    if (parts.length !== 4) {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "格式：/設定價格 商品 售價 抽成"
      });
    }

    await appendSheet("Pricing!A:C", [[
      parts[1],
      Number(parts[2]),
      Number(parts[3])
    ]]);

    return client.replyMessage(
      event.replyToken,
      flexCard("價格設定完成", `${parts[1]} ${parts[2]} → ${parts[3]}`)
    );
  }

  if (msg.startsWith("/結算 ")) {
    const employee = msg.replace("/結算 ", "").trim();

    activeSettlement.set(userId, employee);

    return client.replyMessage(
      event.replyToken,
      flexCard(
        "結算模式",
        `${employee}\n請貼多筆訂單:\n售價 8591編號`
      )
    );
  }  if (msg === "/管理總表") {
    if (role !== "admin") {
      return client.replyMessage(event.replyToken, {
        type: "text",
        text: "只有 admin 可用"
      });
    }

    const rows = await getSheet("Sheet1!A:G");

    let totalRevenue = 0;
    let totalCommission = 0;

    rows.forEach(r => {
      totalRevenue += Number(r[3]) || 0;
      totalCommission += Number(r[4]) || 0;
    });

    return client.replyMessage(
      event.replyToken,
      flexCard(
        "管理總表",
        `總營收：${totalRevenue}\n總抽成：${totalCommission}`
      )
    );
  }

  if (msg.startsWith("/查詢 ")) {
    const target = msg.replace("/查詢 ", "").trim();
    const ledger = await getSheet("Ledger!A:E");

    let owedToYou = 0;
    let youOwe = 0;

    ledger.forEach(r => {
      const debtor = r[1];
      const creditor = r[2];
      const amount = Number(r[3]) || 0;

      if (debtor === target && creditor === actorName) {
        owedToYou += amount;
      }

      if (debtor === actorName && creditor === target) {
        youOwe += amount;
      }
    });

    return client.replyMessage(
      event.replyToken,
      flexCard(
        `與 ${target} 帳務`,
        `${target} 欠你：${owedToYou}\n你欠對方：${youOwe}\n淨額：${owedToYou - youOwe}`
      )
    );
  }

 if (activeSettlement.has(userId)) {
  const employee = activeSettlement.get(userId);

  try {
    const pricing = await getSheet("Pricing!A:C");
    const existingOrders = new Set((await getSheet("Sheet1!G:G")).flat());

    const lines = msg.split("\n").map(v => v.trim()).filter(Boolean);

    let totalRevenue = 0;
    let totalCommission = 0;
    let orderCount = 0;
    const rows = [];

    for (const line of lines) {
      const parts = line.split(/\s+/);

      if (parts.length < 2) continue;

      const price = Number(parts[0]);
      const orderId = parts[1];

      if (!price || !orderId) continue;
      if (existingOrders.has(orderId)) continue;

      const matched = pricing.find(r => Number(r[1]) === price);

      if (!matched) continue;

      const commission = Number(matched[2]);

      rows.push([
        nowTW(),
        employee,
        matched[0],
        price,
        commission,
        price - commission,
        orderId
      ]);

      totalRevenue += price;
      totalCommission += commission;
      orderCount++;
    }

    return client.replyMessage(
      event.replyToken,
      flexCard(
        `${employee} 結算完成`,
        `訂單：${orderCount}
總營收：${totalRevenue}
總抽成：${totalCommission}`
      )
    );

  } finally {
    if (rows.length) {
      await appendSheet("Sheet1!A:G", rows);
    }

    activeSettlement.delete(userId);
  }
}

  const debtMatch = msg.match(/^(.+?)\s*([+-])\s*(\d+)(?:\s+(.+))?$/);

console.log("收到訊息:", msg);
console.log("debtMatch結果:", debtMatch);

  if (debtMatch) {
  const target = debtMatch[1].trim();
  const sign = debtMatch[2];
  const amount = Number(debtMatch[3]);
  const note = debtMatch[4] || "";

  const debtor = sign === "-" ? target : actorName;
  const creditor = sign === "-" ? actorName : target;

  const ledger = await getSheet("Ledger!A:E");

  let balance = 0;

  ledger.forEach(r => {
    const d = r[1];
    const c = r[2];
    const amt = Number(r[3]) || 0;

    if (d === target && c === actorName) {
      balance += amt;
    }

    if (d === actorName && c === target) {
      balance -= amt;
    }
  });

  const signedAmount = sign === "-" ? amount : -amount;
  const newBalance = balance + signedAmount;

  await appendSheet("Ledger!A:E", [[
    nowTW(),
    debtor,
    creditor,
    amount,
    note
  ]]);

  let statusText = "";

  if (newBalance > 0) {
    statusText = `${target} 目前欠你 ${newBalance}`;
  } else if (newBalance < 0) {
    statusText = `你目前欠 ${target} ${Math.abs(newBalance)}`;
  } else {
    statusText = "目前雙方已結清";
  }

  return client.replyMessage(
    event.replyToken,
    flexCard(
      "帳務已記錄",
      `${target} 與 ${actorName}

前次金額：${balance}
本次金額：${signedAmount}
目前總額：${newBalance}

${statusText}

備註：${note || "無"}`
    )
  );
}

  return null;
}

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("ERP Bot V6 running");
});
