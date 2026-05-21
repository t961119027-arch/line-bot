require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const { google } = require("googleapis");

const requiredEnv = [
  "CHANNEL_ACCESS_TOKEN",
  "CHANNEL_SECRET",
  "GOOGLE_CLIENT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "SPREADSHEET_ID"
];

const missingEnv = requiredEnv.filter(name => !process.env[name]);

if (missingEnv.length) {
  throw new Error(`Missing required env: ${missingEnv.join(", ")}`);
}

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

const topupOrderHeaders = [
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
];

async function ensureTopupSheet() {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title"
  });

  const titles = new Set(
    (spreadsheet.data.sheets || []).map(sheet => sheet.properties.title)
  );

  if (!titles.has("TopupOrders")) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: "TopupOrders"
              }
            }
          }
        ]
      }
    });
  }

  const current = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "TopupOrders!A1:J1"
  });

  if (!current.data.values || !current.data.values[0]) {
    await updateSheet("TopupOrders!A1:J1", [topupOrderHeaders]);
  }
}

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
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "smart-raccoon-m-v7",
    time: nowTW()
  });
});

const adminLineUserIds = (process.env.ADMIN_LINE_USER_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

function makeOrderId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `T${stamp}${random}`;
}

function isTopupAdmin(userId, permission) {
  return adminLineUserIds.includes(userId) || (permission && permission[2] === "admin");
}

function topupStatusText(status) {
  return {
    pending_payment: "待付款",
    payment_reported: "已回報付款，待審核",
    approved: "已核准，處理中",
    completed: "已完成",
    rejected: "已退回"
  }[status] || status;
}

function parseTopupOrderRow(row) {
  return {
    id: row[0] || "",
    createdAt: row[1] || "",
    userId: row[2] || "",
    groupId: row[3] || "",
    product: row[4] || "",
    amount: row[5] || "",
    note: row[6] || "",
    status: row[7] || "",
    paymentNote: row[8] || "",
    updatedAt: row[9] || ""
  };
}

function formatTopupOrder(order) {
  return [
    `訂單：${order.id}`,
    `商品：${order.product}`,
    `金額：${order.amount ? `NT$${formatMoney(order.amount)}` : "待確認"}`,
    `狀態：${topupStatusText(order.status)}`,
    order.note ? `資料：${order.note}` : "",
    order.paymentNote ? `付款：${order.paymentNote}` : "",
    `時間：${order.createdAt}`
  ].filter(Boolean).join("\n");
}

function topupOrderGuide() {
  return [
    "直接照這個格式傳：",
    "商品 金額 遊戲ID",
    "",
    "例如：",
    "傳說點券 300 abc123",
    "",
    "也可以傳：",
    "下單 傳說點券 300 abc123"
  ].join("\n");
}

function paymentGuide(orderId = "T訂單編號") {
  return [
    "付款後照這個格式傳：",
    `付款回報 ${orderId} 末五碼`,
    "",
    "例如：",
    `付款回報 ${orderId} 12345`
  ].join("\n");
}

async function getTopupOrders() {
  const rows = await getSheet("TopupOrders!A:J");
  return rows.slice(1);
}

async function createTopupOrder(userId, groupId, product, amount, note) {
  const order = {
    id: makeOrderId(),
    createdAt: nowTW(),
    userId,
    groupId,
    product,
    amount,
    note,
    status: "pending_payment",
    paymentNote: "",
    updatedAt: nowTW()
  };

  await appendSheet("TopupOrders!A:J", [[
    order.id,
    order.createdAt,
    order.userId,
    order.groupId,
    order.product,
    order.amount,
    order.note,
    order.status,
    order.paymentNote,
    order.updatedAt
  ]]);

  return order;
}

async function updateTopupOrder(orderId, updater) {
  const rows = await getSheet("TopupOrders!A:J");
  const index = rows.findIndex(row => row[0] === orderId);

  if (index < 1) return null;

  const row = rows[index];
  const order = parseTopupOrderRow(row);
  const updates = updater(order);

  if (updates === null) return null;

  const next = { ...order, ...updates, updatedAt: nowTW() };

  const nextRow = [
    next.id,
    next.createdAt,
    next.userId,
    next.groupId,
    next.product,
    next.amount,
    next.note,
    next.status,
    next.paymentNote,
    next.updatedAt
  ];

  await updateSheet(`TopupOrders!A${index + 1}:J${index + 1}`, [nextRow]);
  return next;
}

async function findLatestTopupOrder(userId) {
  const orders = await getTopupOrders();
  const row = orders.reverse().find(item => item[2] === userId);
  return row ? parseTopupOrderRow(row) : null;
}

async function listPendingTopupOrders(limit = 10) {
  const orders = await getTopupOrders();
  return orders
    .map(parseTopupOrderRow)
    .filter(order => ["pending_payment", "payment_reported", "approved"].includes(order.status))
    .reverse()
    .slice(0, limit);
}

async function notifyTopupAdmins(order, title) {
  if (!adminLineUserIds.length) return;

  const text = `${title}\n\n${formatTopupOrder(order)}\n\n管理：\n核准 ${order.id}\n完成 ${order.id}\n退回 ${order.id}`;

  await Promise.allSettled(adminLineUserIds.map(to =>
    client.pushMessage(to, { type: "text", text })
  ));
}

async function replyTopupHelp(event) {
  return client.replyMessage(
    event.replyToken,
    flexCard(
      "代儲服務",
      "請選擇：",
      [
        { label: "我要下單", text: "我要下單" },
        { label: "付款回報", text: "付款回報" },
        { label: "查詢訂單", text: "查詢訂單" }
      ]
    )
  );
}

async function replyTopupProducts(event) {
  const pricing = await getSheet("Pricing!A:C");
  const text = pricing.length
    ? `${pricing.map(row => `${row[0]}：NT$${formatMoney(row[1])}`).join("\n")}\n\n${topupOrderGuide()}`
    : topupOrderGuide();

  return client.replyMessage(event.replyToken, flexCard("我要下單", text));
}

function parseTopupOrderMessage(msg) {
  const normalized = msg.startsWith("下單 ") ? msg.replace(/^下單\s+/, "") : msg;
  const match = normalized.match(/^(.+?)\s+(\d+)(?:\s+(.+))?$/);
  if (!match) return null;

  return {
    product: match[1].trim(),
    amount: Number(match[2]),
    note: (match[3] || "").trim()
  };
}

async function handleTopupCommand(event, msg, userId, groupId, permission) {
  const lowerMsg = msg.toLowerCase();

  if (["代儲", "代儲選單", "儲值", "topup"].includes(lowerMsg)) {
    return replyTopupHelp(event);
  }

  if (["我要下單", "下單", "代儲品項", "商品"].includes(msg)) {
    return replyTopupProducts(event);
  }

  if (msg === "付款回報") {
    const order = await findLatestTopupOrder(userId);
    return client.replyMessage(
      event.replyToken,
      flexCard("付款回報", paymentGuide(order ? order.id : "T訂單編號"))
    );
  }

  if (msg.startsWith("付款回報 ")) {
    const match = msg.match(/^付款回報\s+(T[A-Z0-9]+)\s+(.+)$/i);

    if (!match) {
      return client.replyMessage(event.replyToken, flexCard("付款回報", paymentGuide()));
    }

    const order = await updateTopupOrder(match[1].toUpperCase(), existing => {
      if (existing.userId !== userId && !isTopupAdmin(userId, permission)) return null;
      return { status: "payment_reported", paymentNote: match[2] };
    });

    if (!order) {
      return client.replyMessage(event.replyToken, flexCard("查無訂單", "找不到這筆訂單，請確認訂單編號。"));
    }

    await notifyTopupAdmins(order, "付款回報");

    return client.replyMessage(
      event.replyToken,
      flexCard("已收到", `${formatTopupOrder(order)}\n\n客服確認後會通知你。`)
    );
  }

  if (msg === "查詢訂單" || msg === "我的訂單") {
    const order = await findLatestTopupOrder(userId);
    return client.replyMessage(
      event.replyToken,
      flexCard("我的訂單", order ? formatTopupOrder(order) : "目前查不到你的訂單。")
    );
  }

  if (msg === "待處理訂單") {
    if (!isTopupAdmin(userId, permission)) {
      return client.replyMessage(event.replyToken, flexCard("權限不足", "只有管理員可以查看待處理訂單。"));
    }

    const orders = await listPendingTopupOrders();
    const text = orders.length
      ? orders.map(order => `${order.id}｜${topupStatusText(order.status)}｜${order.product}｜NT$${formatMoney(order.amount)}`).join("\n")
      : "目前沒有待處理訂單。";

    return client.replyMessage(event.replyToken, flexCard("待處理訂單", text));
  }

  const adminMatch = msg.match(/^(核准|完成|退回)\s+(T[A-Z0-9]+)$/i);
  if (adminMatch) {
    if (!isTopupAdmin(userId, permission)) {
      return client.replyMessage(event.replyToken, flexCard("權限不足", "只有管理員可以更新訂單。"));
    }

    const statusMap = {
      "核准": "approved",
      "完成": "completed",
      "退回": "rejected"
    };

    const order = await updateTopupOrder(adminMatch[2].toUpperCase(), () => ({
      status: statusMap[adminMatch[1]]
    }));

    if (!order) {
      return client.replyMessage(event.replyToken, flexCard("查無訂單", "找不到這筆訂單。"));
    }

    await client.pushMessage(order.userId, {
      type: "text",
      text: `你的訂單狀態更新了。\n\n${formatTopupOrder(order)}`
    });

    return client.replyMessage(event.replyToken, flexCard("已更新", formatTopupOrder(order)));
  }

  const orderDraft = parseTopupOrderMessage(msg);
  const isPrivateChat = event.source.type === "user";

  if (orderDraft && (isPrivateChat || msg.startsWith("下單 "))) {
    const order = await createTopupOrder(
      userId,
      groupId,
      orderDraft.product,
      orderDraft.amount,
      orderDraft.note || "未填"
    );

    await notifyTopupAdmins(order, "新訂單");

    return client.replyMessage(
      event.replyToken,
      flexCard(
        "下單成功",
        `${formatTopupOrder(order)}\n\n${paymentGuide(order.id)}`
      )
    );
  }

  return null;
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

async function handleEvent(event) {
  
  if (event.type !== "message" || event.message.type !== "text") {
    return null;
  }

  const msg = event.message.text.trim();
  const userId = event.source.userId;
  const groupId = event.source.groupId || "";
  const earlyPermission = groupId ? await getPermission(userId, groupId) : null;
  const topupResponse = await handleTopupCommand(event, msg, userId, groupId, earlyPermission);

  if (topupResponse) {
    return topupResponse;
  }

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

  const permission = earlyPermission || await getPermission(userId, groupId);

const needsPermission =
  msg !== "/綁定群組" &&
  (
    msg.startsWith("/") ||
    /^[+-]/.test(msg) ||
    /^(完成|收款|退款)/.test(msg)
  );

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

  const actionMatch = msg.match(
  /^(?:(完成|收款|退款))?([+-])([0-9.*]+)(?:\s+(.*))?$/
);

  if (actionMatch) {
    const action = actionMatch[1];
    const sign = actionMatch[2];
    const rawFormula = actionMatch[3];
    const note = actionMatch[4] || "";

    let amount = 0;

    if (rawFormula.includes("*")) {
      const parts = rawFormula.split("*").map(v => Number(v.trim()));

      if (parts.some(isNaN)) {
        return client.replyMessage(
          event.replyToken,
          flexCard("格式錯誤", "算式格式錯誤")
        );
      }

      amount = parts.reduce((a, b) => a * b, 1);
    } else {
      amount = Number(rawFormula);

      if (isNaN(amount)) {
        return client.replyMessage(
          event.replyToken,
          flexCard("格式錯誤", "金額格式錯誤")
        );
      }
    }

    let signedAmount = 0;

if (!action) {
  // 快捷模式：+100 / -100
  signedAmount = sign === "+" ? amount : -amount;
} else if (action === "完成") {
  // 完成+100 / 完成-100
  signedAmount = sign === "+" ? amount : -amount;
} else if (action === "收款") {
  // 收款固定減少欠款
  signedAmount = -Math.abs(amount);
} else if (action === "退款") {
  // 退款固定減少欠款
  signedAmount = -Math.abs(amount);
}

    const ledger = await getSheet("GroupLedger!A:H");

    let balance = 0;

    ledger.forEach(r => {
      if (r[1] === groupId) {
        balance = Number(r[6]) || 0;
      }
    });

    const newBalance = balance + signedAmount;

    await appendSheet("GroupLedger!A:H", [[
      nowTW(),
      groupId,
      aName,
      bName,
      `${sign}${rawFormula}`,
      signedAmount,
      newBalance,
      note
    ]]);

    let statusText = "";

    if (newBalance > 0) {
      statusText = `${bName} 目前欠 ${aName} ${formatMoney(newBalance)}`;
    } else if (newBalance < 0) {
      statusText = `${aName} 目前欠 ${bName} ${formatMoney(Math.abs(newBalance))}`;
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
本次變動：${sign}${rawFormula} = ${formatMoney(signedAmount)}
目前總額：${formatMoney(newBalance)}

${statusText}

備註：${note || ""}`
      )
    );
  }
}  
  
  if (msg === "/查詢") {
  const configRow = await getGroupConfig(groupId);

  if (!configRow) {
    return client.replyMessage(
      event.replyToken,
      flexCard("未設定", "請先設定 A / B")
    );
  }

  const aName = configRow[1];
  const bName = configRow[2];

  const ledger = await getSheet("GroupLedger!A:H");

  const groupRows = ledger.filter(r => r[1] === groupId);

  let balance = 0;
  let lastFormula = "";
  let lastNote = "";

  if (groupRows.length) {
    const last = groupRows[groupRows.length - 1];
    balance = Number(last[6]) || 0;
    lastFormula = last[4] || "";
    lastNote = last[7] || "";
  }

  let statusText = "";

  if (balance > 0) {
    statusText = `${bName} 目前欠 ${aName} ${formatMoney(balance)}`;
  } else if (balance < 0) {
    statusText = `${aName} 目前欠 ${bName} ${formatMoney(Math.abs(balance))}`;
  } else {
    statusText = "目前雙方已結清";
  }

  return client.replyMessage(
    event.replyToken,
    flexCard(
      "帳務查詢",
      `A：${aName}
B：${bName}

最後變動：${lastFormula}
備註：${lastNote}

目前總額：${formatMoney(balance)}

${statusText}`
    )
  );
}
  if (msg === "/清帳") {
  if (role !== "admin") {
    return client.replyMessage(
      event.replyToken,
      flexCard("限制", "只有 admin 可清帳")
    );
  }

  const configRow = await getGroupConfig(groupId);

  if (!configRow) {
    return client.replyMessage(
      event.replyToken,
      flexCard("未設定", "請先設定 A / B")
    );
  }

  const aName = configRow[1];
  const bName = configRow[2];

  const ledger = await getSheet("GroupLedger!A:H");

  let balance = 0;

  ledger.forEach(r => {
    if (r[1] === groupId) {
      balance = Number(r[6]) || 0;
    }
  });

  await appendSheet("GroupLedger!A:H", [[
    nowTW(),
    groupId,
    aName,
    bName,
    "CLEAR",
    -balance,
    0,
    "CLEARED"
  ]]);

  return client.replyMessage(
    event.replyToken,
    flexCard(
      "清帳成功",
      `清帳前：${formatMoney(balance)}
目前總額：0`
    )
  );
}

  if (msg.startsWith("/撤銷") || msg.startsWith("/撤回")) {
  if (role !== "admin") {
    return client.replyMessage(
      event.replyToken,
      flexCard("限制", "只有 admin 可撤銷")
    );
  }

  const ledger = await getSheet("GroupLedger!A:H");

  const groupRows = ledger.filter(r => r[1] === groupId);

  if (!groupRows.length) {
    return client.replyMessage(
      event.replyToken,
      flexCard("撤銷失敗", "沒有可撤銷資料")
    );
  }

  // 找最後一筆這個群組資料
  let removed = false;

  const remaining = ledger.filter(r => {
    if (!removed && r[1] === groupId) {
      const isLast =
        r === groupRows[groupRows.length - 1];

      if (isLast) {
        removed = true;
        return false;
      }
    }

    return true;
  });

  // 先清空整個 sheet
  await updateSheet("GroupLedger!A:H", []);

  // 再重寫
  if (remaining.length) {
    await updateSheet("GroupLedger!A:H", remaining);
  }

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
  ensureTopupSheet()
    .then(() => console.log("TopupOrders sheet ready"))
    .catch(err => console.error("TopupOrders sheet setup failed:", err.message));
});
