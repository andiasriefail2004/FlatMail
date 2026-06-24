# FlatMail 📬

A disposable email Telegram bot powered by Cloudflare Workers and Cloudflare Email Routing. Get instant temporary email addresses and receive real-time notifications with automatic OTP detection — all inside Telegram.

🤖 **Try it:** [@FlatMailBot](https://t.me/FlatMailBot)

> **Note:** This repository only contains the core email receiving feature. Additional features (send email, premium plans, payment system, multi-slot, etc.) are not included in this public release.

---

## Features

- 📬 Instant disposable email generation
- 🔑 Automatic OTP & verification code detection
- 📩 Real-time email notifications via Telegram
- ⏱️ Auto-expiring emails with expiry warnings
- 🗑️ Manual email deletion
- 🌐 Powered entirely by Cloudflare free tier

---

## How It Works

```
Email sent to your@flatmail.qzz.io
        ↓
Cloudflare Email Routing
        ↓
Cloudflare Worker (this code)
        ↓
Parse email → detect OTP
        ↓
Telegram notification with Copy Code button
```

---

## Stack

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Cloudflare KV](https://developers.cloudflare.com/kv/)
- [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [postal-mime](https://github.com/postalsys/postal-mime)
- [html-to-text](https://github.com/html-to-text/node-html-to-text)

---

## Requirements

- Cloudflare account (free)
- Domain connected to Cloudflare
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/andiasriefail2004/FlatMail.git
cd FlatMail
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure `wrangler.toml`

```toml
name = "flatmail-bot"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "FLATMAIL"
id = "YOUR_KV_NAMESPACE_ID"

[triggers]
crons = ["* * * * *"]
```

### 4. Add secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

`TELEGRAM_CHAT_ID` is your personal Telegram ID (owner). Get it from [@userinfobot](https://t.me/userinfobot).

### 5. Set up Cloudflare Email Routing

In your Cloudflare dashboard:
1. Go to your domain → **Email Routing**
2. Enable Email Routing
3. Add a **Catch-all** rule → action: **Send to Worker** → select your deployed worker

### 6. Set Telegram webhook

```
https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://YOUR_WORKER_URL
```

### 7. Deploy

```bash
wrangler deploy
```

---

## Commands

| Command | Description |
|---|---|
| `/start` | Generate a new temporary email |
| `/next` | Replace current email with a new one |

---

## Configuration

Edit constants at the top of `src/index.js` to customize behavior:

| Constant | Default | Description |
|---|---|---|
| `DOMAIN` | `flatmail.qzz.io` | Your email domain |
| `FREE_TTL` | `600` | Email lifetime in seconds (10 min) |
| `FREE_DAILY_LIMIT` | `3` | Max emails per day for free users |

---

## KV Structure

| Key | Description |
|---|---|
| `email:{address}` | Email record (chatId, expiry, etc.) |
| `expiry:{address}` | Expiry tracking for cron job |
| `user:{chatId}` | User data |
| `daily:{chatId}:{date}` | Daily usage counter |

---

## License

MIT

---

## Author

[@andiasriefail2004](https://github.com/andiasriefail2004)

