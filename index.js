require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");

const app = express();

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

function nowTW() {
  return new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei"
  });
}

function formatMoney(num) {
  return Number(num || 0).toLocaleString("zh-TW");
}

function flexCard(title, body, buttons = []) {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      hero: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0A0A0A",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "智能浣熊 M",
            color: "#D4AF37",
            weight: "bold",
            size: "xl"
          },
          {
            type: "text",
            text: nowTW(),
            color: "#888888",
            size: "xs",
            margin: "sm"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#111111",
        contents: [
          {
            type: "text",
            text: title,
            color: "#D4AF37",
            size: "lg",
            weight: "bold"
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
            color: "#FFFFFF",
            size: "sm"
          }
        ]
      },
      footer: buttons.length
        ? {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            backgroundColor: "#111111",
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

async function getPermission(userId, groupId) {
  const rows = await getSheet("Permissions!A:D");
  return rows.find(r => r[0] === groupId && r[1] === userId);
}

async function getGroupConfig(groupId) {
  const rows = await getSheet("GroupConfig!A:C");
  return rows.find(r => r[0] === groupId);
}

async function writeAudit(groupId, userName, action) {
  await appendSheet("AuditLog!A:D", [[
    nowTW(),
    groupId,
    userName,
    action
  ]]);
}

function requireGroup(event) {
  return event.source.type === "group";
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
  const groupId = event.source.groupId || "";

  if (!requireGroup(event)) {
    return client.replyMessage(
      event.replyToken,
      flexCard("限制", "此機器人僅限群組使用")
    );
  }

  if (msg === "/綁定群組") {
    const perms = await getSheet("Permissions!A:D");

    const alreadyAdmin = perms.find(
      r => r[0] === groupId && r[2] === "admin"
    );

    if (alreadyAdmin) {
      return client.replyMessage(
        event.replyToken,
        flexCard("限制", "此群組已綁定")
      );
    }

    const profile = await client.getGroupMemberProfile(groupId, userId);

    await appendSheet("Permissions!A:D", [[
      groupId,
      userId,
      "admin",
      profile.displayName
    ]]);

    await writeAudit(groupId, profile.displayName, "綁定群組");

    return client.replyMessage(
      event.replyToken,
      flexCard("綁定成功", `${profile.displayName} 已成為 admin`)
    );
  }

  const permission = await getPermission(userId, groupId);

const needsPermission =
  msg.startsWith("/") ||
  /^(完成|收款|退款)([+-])(\d+)$/.test(msg);

if (needsPermission && !permission) {
  return null;
}

const role = permission ? permission[2] : "";
const actorName = permission ? permission[3] : "";

  if (msg === "/選單") {
    return client.replyMessage(
      event.replyToken,
      flexCard("工作室控制台", "主選單", [
        { label: "💳 帳務", text: "/查詢" },
        { label: "💰 價格表", text: "/價格表" },
        { label: "👤 個人財務", text: "/我的帳" },
        { label: "➡ 更多", text: "/選單2" }
      ])
    );
  }

  if (msg === "/選單2") {
    return client.replyMessage(
      event.replyToken,
      flexCard("管理中心", "進階功能", [
        { label: "🏢 公司金流", text: "/金流" },
        { label: "📊 薪資排行", text: "/薪資排行" },
        { label: "⚙ 狀態", text: "/狀態" },
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
  if (msg.startsWith("/設定 ")) {
  if (role !== "admin") {
    return client.replyMessage(
      event.replyToken,
      flexCard("限制", "只有 admin 可設定")
    );
  }

  const parts = msg.replace("/設定 ", "").trim().split(" ");

  if (parts.length < 2) {
    return client.replyMessage(
      event.replyToken,
      flexCard("格式錯誤", "/設定 A名稱 B名稱")
    );
  }

  const aName = parts[0];
  const bName = parts[1];

  const rows = await getSheet("GroupConfig!A:C");
  const idx = rows.findIndex(r => r[0] === groupId);

  if (idx >= 0) {
    rows[idx] = [groupId, aName, bName];
    await updateSheet("GroupConfig!A:C", rows);
  } else {
    await appendSheet("GroupConfig!A:C", [[groupId, aName, bName]]);
  }

  return client.replyMessage(
    event.replyToken,
    flexCard(
      "設定完成",
      `A：${aName}\nB：${bName}`
    )
  );
}

  if (msg.startsWith("/設定A ")) {
  if (role !== "admin") {
    return client.replyMessage(
      event.replyToken,
      flexCard("限制", "只有 admin 可設定")
    );
  }

  const aName = msg.replace("/設定A ", "").trim();
  const rows = await getSheet("GroupConfig!A:C");

  const idx = rows.findIndex(r => r[0] === groupId);

  if (idx >= 0) {
    rows[idx] = [
      groupId,
      aName,
      rows[idx][2] || ""
    ];

    await updateSheet("GroupConfig!A:C", rows);
  } else {
    await appendSheet("GroupConfig!A:C", [[
      groupId,
      aName,
      ""
    ]]);
  }

  return client.replyMessage(
    event.replyToken,
    flexCard("設定完成", `A：${aName}`)
  );
}

  if (msg.startsWith("/設定B ")) {
  if (role !== "admin") {
    return client.replyMessage(
      event.replyToken,
      flexCard("限制", "只有 admin 可設定")
    );
  }

  const bName = msg.replace("/設定B ", "").trim();
  const rows = await getSheet("GroupConfig!A:C");

  const idx = rows.findIndex(r => r[0] === groupId);

  if (idx >= 0) {
    rows[idx] = [
      groupId,
      rows[idx][1] || "",
      bName
    ];

    await updateSheet("GroupConfig!A:C", rows);
  } else {
    await appendSheet("GroupConfig!A:C", [[
      groupId,
      "",
      bName
    ]]);
  }

  return client.replyMessage(
    event.replyToken,
    flexCard("設定完成", `B：${bName}`)
  );
}

  if (msg === "/角色") {
    const configRow = await getGroupConfig(groupId);

    if (!configRow) {
      return client.replyMessage(
        event.replyToken,
        flexCard("未設定", "請先設定 A / B")
      );
    }

    return client.replyMessage(
      event.replyToken,
      flexCard(
        "群組角色",
        `A：${configRow[1]}\nB：${configRow[2]}`
      )
    );
  }
  
  if (msg.startsWith("/授權 ")) {
  if (role !== "admin") {
    return client.replyMessage(
      event.replyToken,
      flexCard("限制", "只有 admin 可授權")
    );
  }

  const targetName = msg.replace("/授權 ", "").trim();

  const rows = await getSheet("Permissions!A:D");

  const exists = rows.find(
    r => r[0] === groupId && r[3] === targetName
  );

  if (exists) {
    return client.replyMessage(
      event.replyToken,
      flexCard("提示", `${targetName} 已有權限`)
    );
  }

  await appendSheet("Permissions!A:D", [[
    groupId,
    `manual-${Date.now()}`,
    "staff",
    targetName
  ]]);

  return client.replyMessage(
    event.replyToken,
    flexCard("授權成功", `${targetName} 已授權`)
  );
}

if (msg.startsWith("/拔權 ")) {
  if (role !== "admin") {
    return client.replyMessage(
      event.replyToken,
      flexCard("限制", "只有 admin 可拔權")
    );
  }

  const targetName = msg.replace("/拔權 ", "").trim();

  const rows = await getSheet("Permissions!A:D");

  const filtered = rows.filter(
    r => !(r[0] === groupId && r[3] === targetName)
  );

  await updateSheet("Permissions!A:D", filtered);

  return client.replyMessage(
    event.replyToken,
    flexCard("拔權成功", `${targetName} 已移除`)
  );
}
  if (msg === "/價格表") {
    const pricing = await getSheet("Pricing!A:C");

    if (!pricing.length) {
      return client.replyMessage(
        event.replyToken,
        flexCard("價格表", "尚未設定價格")
      );
    }

    const text = pricing
      .map(r => `${r[0]}｜${formatMoney(r[1])}｜抽成 ${formatMoney(r[2])}`)
      .join("\n");

    return client.replyMessage(
      event.replyToken,
      flexCard("價格表", text)
    );
  }

  if (msg.startsWith("/設定價格 ")) {
    if (role !== "admin") {
      return client.replyMessage(
        event.replyToken,
        flexCard("限制", "只有 admin 可設定價格")
      );
    }

    const parts = msg.split(" ");

    if (parts.length !== 4) {
      return client.replyMessage(
        event.replyToken,
        flexCard("格式錯誤", "/設定價格 商品 售價 抽成")
      );
    }

    const product = parts[1];
    const price = Number(parts[2]);
    const commission = Number(parts[3]);

    const pricing = await getSheet("Pricing!A:C");
    const existingIndex = pricing.findIndex(r => Number(r[1]) === price);

    if (existingIndex >= 0) {
      const oldCommission = pricing[existingIndex][2];

      pricing[existingIndex] = [product, price, commission];
      await updateSheet("Pricing!A:C", pricing);

      await writeAudit(groupId, actorName, `更新價格 ${price}`);

      return client.replyMessage(
        event.replyToken,
        flexCard(
          "價格已更新",
          `商品：${product}
售價：${formatMoney(price)}
舊抽成：${formatMoney(oldCommission)}
新抽成：${formatMoney(commission)}`
        )
      );
    }

    await appendSheet("Pricing!A:C", [[product, price, commission]]);

    await writeAudit(groupId, actorName, `新增價格 ${price}`);

    return client.replyMessage(
      event.replyToken,
      flexCard(
        "價格新增",
        `${product}
售價：${formatMoney(price)}
抽成：${formatMoney(commission)}`
      )
    );
  }

  if (msg.startsWith("/刪除價格 ")) {
    if (role !== "admin") {
      return client.replyMessage(
        event.replyToken,
        flexCard("限制", "只有 admin 可刪除")
      );
    }

    const price = Number(msg.replace("/刪除價格 ", "").trim());
    const pricing = await getSheet("Pricing!A:C");

    const filtered = pricing.filter(r => Number(r[1]) !== price);

    await updateSheet("Pricing!A:C", filtered);

    await writeAudit(groupId, actorName, `刪除價格 ${price}`);

    return client.replyMessage(
      event.replyToken,
      flexCard("刪除完成", `已刪除 ${formatMoney(price)}`)
    );
  }

  const configRow = await getGroupConfig(groupId);

  if (configRow) {
    const aName = configRow[1];
    const bName = configRow[2];

    const actionMatch = msg.match(/^(完成|收款|退款)([+-])(\d+)$/);

    if (actionMatch) {
      const action = actionMatch[1];
      const amount = Number(actionMatch[3]);

      let signedAmount = 0;

      if (action === "完成") signedAmount = amount;
      if (action === "收款") signedAmount = -amount;
      if (action === "退款") signedAmount = -amount;

      const ledger = await getSheet("GroupLedger!A:F");

      let balance = 0;
      let lastChange = 0;

      ledger.forEach(r => {
        if (r[1] === groupId) {
          balance = Number(r[5]) || 0;
          lastChange = Number(r[4]) || 0;
        }
      });

      const newBalance = balance + signedAmount;

      await appendSheet("GroupLedger!A:F", [[
        nowTW(),
        groupId,
        aName,
        bName,
        signedAmount,
        newBalance
      ]]);

      await writeAudit(groupId, actorName, `${action} ${amount}`);

      let statusText = "";

      if (newBalance > 0) {
        statusText = `${bName} 目前欠你 ${formatMoney(newBalance)}`;
      } else if (newBalance < 0) {
        statusText = `你目前欠 ${bName} ${formatMoney(Math.abs(newBalance))}`;
      } else {
        statusText = "目前雙方已結清";
      }

      return client.replyMessage(
        event.replyToken,
        flexCard(
          "帳務更新",
          `A：${aName}
B：${bName}

前次金額：${formatMoney(balance)}
本次變動：${signedAmount > 0 ? "+" : ""}${formatMoney(signedAmount)}
目前總額：${formatMoney(newBalance)}

${statusText}`
        )
      );
    }
  }  if (msg === "/查詢") {
    const configRow = await getGroupConfig(groupId);

    if (!configRow) {
      return client.replyMessage(
        event.replyToken,
        flexCard("未設定", "請先設定 A / B")
      );
    }

    const aName = configRow[1];
    const bName = configRow[2];

    const ledger = await getSheet("GroupLedger!A:F");

    let balance = 0;
    let lastChange = 0;

    ledger.forEach(r => {
      if (r[1] === groupId) {
        lastChange = Number(r[4]) || 0;
        balance = Number(r[5]) || 0;
      }
    });

    let statusText = "";

    if (balance > 0) {
      statusText = `${bName} 目前欠你 ${formatMoney(balance)}`;
    } else if (balance < 0) {
      statusText = `你目前欠 ${bName} ${formatMoney(Math.abs(balance))}`;
    } else {
      statusText = "目前雙方已結清";
    }

    return client.replyMessage(
      event.replyToken,
      flexCard(
        "帳務查詢",
        `A：${aName}
B：${bName}

前次金額：${formatMoney(balance - lastChange)}
本次變動：${lastChange > 0 ? "+" : ""}${formatMoney(lastChange)}
目前總額：${formatMoney(balance)}

${statusText}`
      )
    );
  }

  if (msg.startsWith("/撤銷")) {
  if (role !== "admin") {
    return client.replyMessage(
      event.replyToken,
      flexCard("限制", "只有 admin 可撤銷")
    );
  }

  const ledger = await getSheet("GroupLedger!A:F");

  const groupRows = ledger.filter(r => r[1] === groupId);

  if (!groupRows.length) {
    return client.replyMessage(
      event.replyToken,
      flexCard("撤銷失敗", "沒有可撤銷資料")
    );
  }

  const remaining = ledger.filter((r, i) => {
    const sameGroup = r[1] === groupId;
    if (!sameGroup) return true;

    return i !== ledger.lastIndexOf(groupRows[groupRows.length - 1]);
  });

  await updateSheet("GroupLedger!A:F", remaining);

  return client.replyMessage(
    event.replyToken,
    flexCard("撤銷成功", "已撤銷上一筆")
  );
}
  if (msg.startsWith("/薪資 ")) {
    const target = msg.replace("/薪資 ", "").trim();
    const rows = await getSheet("Payroll!A:E");

    let count = 0;
    let total = 0;

    rows.forEach(r => {
      if (r[1] === target) {
        count++;
        total += Number(r[4]) || 0;
      }
    });

    return client.replyMessage(
      event.replyToken,
      flexCard(
        `${target} 薪資`,
        `訂單數：${count}
實領：${formatMoney(total)}`
      )
    );
  }

  if (msg === "/薪資排行") {
    const rows = await getSheet("Payroll!A:E");
    const map = {};

    rows.forEach(r => {
      const name = r[1];
      const amount = Number(r[4]) || 0;
      map[name] = (map[name] || 0) + amount;
    });

    const ranking = Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map((r, i) => `${i + 1}. ${r[0]} ${formatMoney(r[1])}`)
      .join("\n");

    return client.replyMessage(
      event.replyToken,
      flexCard("薪資排行", ranking || "無資料")
    );
  }

  if (msg.startsWith("/記帳 ")) {
    const parts = msg.split(" ");

    if (parts.length < 4) {
      return client.replyMessage(
        event.replyToken,
        flexCard("格式錯誤", "/記帳 收入|支出 項目 金額")
      );
    }

    const type = parts[1];
    const item = parts[2];
    const amount = Number(parts[3]);

    await appendSheet("PersonalFinance!A:E", [[
      nowTW(),
      actorName,
      type,
      item,
      amount
    ]]);

    return client.replyMessage(
      event.replyToken,
      flexCard("個人記帳", `${type} ${item} ${formatMoney(amount)}`)
    );
  }

  if (msg === "/我的帳") {
    const rows = await getSheet("PersonalFinance!A:E");

    let income = 0;
    let expense = 0;

    rows.forEach(r => {
      if (r[1] === actorName) {
        if (r[2] === "收入") income += Number(r[4]) || 0;
        if (r[2] === "支出") expense += Number(r[4]) || 0;
      }
    });

    return client.replyMessage(
      event.replyToken,
      flexCard(
        "我的財務",
        `收入：${formatMoney(income)}
支出：${formatMoney(expense)}
淨額：${formatMoney(income - expense)}`
      )
    );
  }

  if (msg.startsWith("/公司 ")) {
    const parts = msg.split(" ");

    if (parts.length < 4) {
      return client.replyMessage(
        event.replyToken,
        flexCard("格式錯誤", "/公司 收入|支出 項目 金額")
      );
    }

    await appendSheet("CompanyFinance!A:E", [[
      nowTW(),
      actorName,
      parts[1],
      parts[2],
      Number(parts[3])
    ]]);

    return client.replyMessage(
      event.replyToken,
      flexCard("公司金流", "已記錄")
    );
  }

  if (msg === "/金流") {
    const rows = await getSheet("CompanyFinance!A:E");

    let income = 0;
    let expense = 0;

    rows.forEach(r => {
      if (r[2] === "收入") income += Number(r[4]) || 0;
      if (r[2] === "支出") expense += Number(r[4]) || 0;
    });

    return client.replyMessage(
      event.replyToken,
      flexCard(
        "公司金流",
        `收入：${formatMoney(income)}
支出：${formatMoney(expense)}
淨利：${formatMoney(income - expense)}`
      )
    );
  }

  return null;
}

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log("Smart Raccoon M V7 running");
});
