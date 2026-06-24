import PostalMime from "postal-mime";
import { convert } from "html-to-text";

const DOMAIN          ="Your@Domain";
const FREE_TTL        = 600;
const FREE_DAILY_LIMIT = 3;

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function extractVerificationCode(text) {
  if (!text) return null;
  const patterns = [
    /(?:code|kode|otp|pin|token|verification|verify|verifikasi)[^\d]*(\d{4,8})/i,
    /(?:code|kode|otp|pin|token|verification|verify|verifikasi)[^\d]*((\d[\d\s\-]{2,10}\d))/i,
    /\b(\d[\d\s\-]{2,10}\d)\b/,
    /\b(\d{4,8})\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const cleaned = (match[1] || match[2] || "").replace(/[\s\-]/g, "");
      if (cleaned.length >= 4 && cleaned.length <= 8) return cleaned;
    }
  }
  return null;
}

function formatAddress(addr) {
  if (!addr) return "";
  if ("group" in addr && Array.isArray(addr.group)) {
    const members = addr.group.map(m => m.address || m.name || "").filter(Boolean).join(", ");
    return addr.name ? `${addr.name}: ${members}` : members;
  }
  if (addr.name && addr.address) return `${addr.name} <${addr.address}>`;
  return addr.address || addr.name || "";
}

function htmlToPlainText(html) {
  if (!html) return "";
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a",   options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "table", options: { uppercaseHeaderCells: false } },
    ],
  });
}

function generateEmail() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let prefix  = "";
  for (let i = 0; i < 8; i++) prefix += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}@${DOMAIN}`;
}

async function sendTelegram(token, chatId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

async function getUser(env, chatId) {
  const raw = await env.FLATMAIL.get(`user:${chatId}`);
  if (!raw) return { chatId, activeEmail: null };
  return JSON.parse(raw);
}

async function saveUser(env, user) {
  await env.FLATMAIL.put(`user:${user.chatId}`, JSON.stringify(user));
}

async function getDailyUsed(env, chatId) {
  const today = new Date().toISOString().slice(0, 10);
  const raw   = await env.FLATMAIL.get(`daily:${chatId}:${today}`);
  return raw ? parseInt(raw) : 0;
}

async function incrementDailyUsed(env, chatId, current) {
  const today = new Date().toISOString().slice(0, 10);
  await env.FLATMAIL.put(`daily:${chatId}:${today}`, String(current + 1), { expirationTtl: 86400 });
}

async function storeEmail(env, email, chatId, ttl) {
  const expiry = Date.now() + ttl * 1000;
  await Promise.all([
    env.FLATMAIL.put(
      `email:${email}`,
      JSON.stringify({ chatId, email, expiry }),
      { expirationTtl: ttl }
    ),
    env.FLATMAIL.put(
      `expiry:${email}`,
      JSON.stringify({ chatId, email, expiry, notified: false }),
      { expirationTtl: ttl + 60 }
    ),
  ]);
  return expiry;
}

async function handleGenerate(env, chatId, token) {
  const user      = await getUser(env, chatId);
  const dailyUsed = await getDailyUsed(env, chatId);

  if (dailyUsed >= FREE_DAILY_LIMIT) {
    await sendTelegram(token, chatId,
      `⚠️ <b>Daily limit reached!</b>\n\nYou have used <b>${FREE_DAILY_LIMIT}</b> emails today.\n\n🔄 Resets at midnight UTC`
    );
    return;
  }

  if (user.activeEmail) {
    await Promise.all([
      env.FLATMAIL.delete(`email:${user.activeEmail}`),
      env.FLATMAIL.delete(`expiry:${user.activeEmail}`),
    ]);
  }

  const email = generateEmail();
  await storeEmail(env, email, chatId, FREE_TTL);
  await incrementDailyUsed(env, chatId, dailyUsed);

  user.activeEmail = email;
  await saveUser(env, user);

  await sendTelegram(token, chatId,
    `📬 <b>Your temporary email:</b>\n\n<code>${email}</code>\n\n⏱ Expires in <b>10 minutes</b>\n📊 Remaining today: <b>${FREE_DAILY_LIMIT - dailyUsed - 1}</b>\n\nYou will be notified when an email arrives.`
  );
}

async function handleWebhook(request, env) {
  const body  = await request.json();
  const token = env.TELEGRAM_BOT_TOKEN;

  if (body.callback_query) {
    const cq   = body.callback_query;
    const data = cq.data;
    const chatId = String(cq.message.chat.id);
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ callback_query_id: cq.id }),
    });
    if (data.startsWith("copy:")) {
      const code = data.replace("copy:", "");
      await sendTelegram(token, chatId, `🔑 <b>Verification Code:</b> <code>${code}</code>`);
    }
    return new Response("ok");
  }

  const message = body?.message;
  if (!message) return new Response("ok");

  const chatId = String(message.chat.id);
  const text   = message.text || "";

  if (text === "/start" || text === "/next") {
    await handleGenerate(env, chatId, token);
  }

  return new Response("ok");
}

async function handleEmail(message, env) {
  const to  = message.to;
  const raw = await env.FLATMAIL.get(`email:${to}`);
  if (!raw) {
    await message.setReject("Unknown address");
    return;
  }

  const { chatId, email } = JSON.parse(raw);

  let parsed;
  try {
    parsed = await PostalMime.parse(message.raw);
  } catch {
    await sendTelegram(
      env.TELEGRAM_BOT_TOKEN, chatId,
      `📩 <b>New Email!</b>\n\n📬 <b>To:</b> <code>${email}</code>\n👤 <b>From:</b> ${escapeHtml(message.from)}\n\n⚠️ <i>Failed to parse email body.</i>`
    );
    await message.setReject("Message processed");
    return;
  }

  const subject = parsed.subject || "(no subject)";
  const fromStr = formatAddress(parsed.from) || message.from || "(unknown)";

  let body = (parsed.text || "").trim();
  if (!body && parsed.html) body = htmlToPlainText(parsed.html);
  body = body.substring(0, 600);

  const verificationCode = extractVerificationCode(body);

  const inlineKeyboard = [];
  if (verificationCode) {
    inlineKeyboard.push([{
      text:          `Copy Code: ${verificationCode}`,
      callback_data: `copy:${verificationCode}`,
    }]);
  }

  let msgText;
  if (verificationCode) {
    msgText =
      `📩 <b>New Email!</b>\n\n` +
      `📬 <b>To:</b> <code>${email}</code>\n` +
      `👤 <b>From:</b> ${escapeHtml(fromStr)}\n` +
      `📋 <b>Subject:</b> ${escapeHtml(subject)}\n\n` +
      `🔑 <b>Verification Code:</b> <code>${verificationCode}</code>`;
  } else {
    const bodyPreview = body ? `\n\n💬 <i>${escapeHtml(body.substring(0, 300))}</i>` : "";
    msgText =
      `📩 <b>New Email!</b>\n\n` +
      `📬 <b>To:</b> <code>${email}</code>\n` +
      `👤 <b>From:</b> ${escapeHtml(fromStr)}\n` +
      `📋 <b>Subject:</b> ${escapeHtml(subject)}` +
      bodyPreview;
  }

  await sendTelegram(
    env.TELEGRAM_BOT_TOKEN, chatId, msgText,
    inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : null
  );

  await message.setReject("Message processed");
}

async function handleCron(env) {
  const now  = Date.now();
  const list = await env.FLATMAIL.list({ prefix: "expiry:" });
  await Promise.all(list.keys.map(async (key) => {
    const raw = await env.FLATMAIL.get(key.name);
    if (!raw) return;
    const data      = JSON.parse(raw);
    const remaining = data.expiry - now;
    if (remaining <= 0) {
      await Promise.all([
        sendTelegram(
          env.TELEGRAM_BOT_TOKEN, data.chatId,
          `🗑 <b>Email expired!</b>\n\n<code>${data.email}</code>\n\nThis address is no longer active.\n\nSend /next to generate a new one.`
        ),
        env.FLATMAIL.delete(key.name),
        env.FLATMAIL.delete(`email:${data.email}`),
      ]);
    } else if (!data.notified && remaining <= 60000) {
      data.notified = true;
      await Promise.all([
        sendTelegram(
          env.TELEGRAM_BOT_TOKEN, data.chatId,
          `⏰ <b>Email expiring soon!</b>\n\n<code>${data.email}</code>\n\nLess than 1 minute remaining!`
        ),
        env.FLATMAIL.put(key.name, JSON.stringify(data), { expirationTtl: 120 }),
      ]);
    }
  }));
}

export default {
  async fetch(request, env) {
    if (request.method === "POST") return handleWebhook(request, env);
    return new Response("FlatMail Bot is running!", { status: 200 });
  },
  async email(message, env) {
    await handleEmail(message, env);
  },
  async scheduled(controller, env) {
    await handleCron(env);
  },
};
