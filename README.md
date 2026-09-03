# 📊 PaperDesk

**Paper-trading simulator for Indian markets** — place orders, track
positions and P&L, and watch live NSE/BSE-style price feeds, without
risking real money. Built as a lightweight PHP + PostgreSQL app that runs
on plain XAMPP — no Node.js, no build step, no npm install.

<br>

## ✨ Features

- **Simulated Trading** — Place orders against live market prices; an
  always-on CLI matching engine (`cli/order-engine.php`) fills
  pending/triggered orders every 2 seconds, independent of whether any
  browser tab is open — just like a real broker's order engine.
- **Live Market Data** — Quotes, candles, and index data streamed from the
  **Angel One SmartAPI**, plus a searchable instrument master list.
- **Portfolio Tracking** — Holdings, open positions, and a P&L summary view.
- **Watchlists & Alerts** — Save instruments to watchlists, set price
  alerts, and get pinged via a **Telegram bot** when they trigger.
- **Auth** — Email/password signup with OTP email verification, "Sign in
  with Google" (Google Identity Services), and forgot/reset password via
  emailed OTP.
- **JWT Sessions** — Bearer tokens stored in `sessionStorage` (no cookies),
  which removes the ambient-credential CSRF attack vector by design and
  auto-clears on tab/browser close.
- **Security Hardening** — Login rate limiting (5 attempts → 15 min
  lockout), an audit log of security-relevant events, and an admin-key
  gate on maintenance endpoints.
- **Reports** — Trade and portfolio reporting page.

<br>

## 🏗️ Architecture

```
paperdesk/
├── *.html / *.css / *.js     # static frontend — no build step
├── api/                      # PHP backend, one file per endpoint
│   ├── config.php            # env loading, password policy, admin-key gate
│   ├── PHPMailer/            # bundled SMTP email library
│   └── pd_instruments_active_only.csv
├── cli/
│   └── order-engine.php      # standalone always-on order matching loop
└── assets/                   # images, logo, PaperDesk User Guide PDF
```

**Backend** — PHP (procedural, one file per endpoint), PostgreSQL (Neon
serverless), JWT auth, SMTP via bundled PHPMailer, Angel One SmartAPI for
market data, Telegram Bot API for alerts.

**Frontend** — Plain HTML, CSS, and vanilla JavaScript. Served as static
files by Apache — no framework, no bundler.

<br>

## 🔌 API Overview

| Endpoint | Description |
|---|---|
| `api/signup.php`, `api/verify-signup-otp.php` | Signup + email OTP verification |
| `api/login.php`, `api/google-login.php` | Email/password and Google Sign-In |
| `api/forgot-password.php`, `api/verify-otp.php`, `api/reset-password.php` | Password reset via emailed OTP |
| `api/me.php`, `api/profile.php`, `api/delete-account.php` | Session profile, updates, account deletion |
| `api/orders.php`, `api/cancel-order.php`, `api/trade.php` | Order placement, cancellation, trade execution |
| `api/positions.php`, `api/holdings.php`, `api/pnl-summary.php` | Portfolio, positions, and P&L |
| `api/watchlists.php`, `api/alerts.php` | Watchlists and price alerts |
| `api/telegram-link.php`, `api/telegram-config.php` | Telegram alert bot linking |
| `api/quotes.php`, `api/candles.php`, `api/indices.php` | Live market data |
| `api/instruments-search.php` | Instrument lookup |
| `api/import-instruments.php`, `api/export-bse-equity.php`, `api/angel-test.php` | Admin/maintenance (key-gated) |

<br>

## 🚀 Getting Started

### Prerequisites
- [XAMPP](https://www.apachefriends.org/) (Apache + PHP, with `pgsql` /
  `pdo_pgsql` extensions enabled)
- A [Neon](https://neon.tech) Postgres database (free tier works)
- API keys/credentials: [Angel One SmartAPI](https://smartapi.angelone.in)
  (broker feed), [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
  (OAuth Client ID), an SMTP account for OTP emails, optionally a
  [Telegram bot token](https://core.telegram.org/bots#botfather) for alerts

### 1. Copy files into XAMPP

```
C:\xampp\htdocs\paperdesk\
```

### 2. Configure environment variables

```bash
cd api
cp .env.example .env
```

Open `.env` and fill in:
- `PD_DB_HOST`, `PD_DB_ENDPOINT_ID`, `PD_DB_USER`, `PD_DB_PASSWORD` — your Neon connection details
- `PD_SMTP_HOST` / `PD_SMTP_PORT` / `PD_SMTP_USER` / `PD_SMTP_PASS` — for OTP emails
- `PD_JWT_SECRET` — generate with `php -r "echo bin2hex(random_bytes(32));"`
- `PD_ALLOWED_ORIGINS` — comma-separated production frontend origin(s)
- `PD_GOOGLE_CLIENT_ID` — for Google Sign-In
- `PD_ANGEL_API_KEY`, `PD_ANGEL_CLIENT_CODE`, `PD_ANGEL_CLIENT_PIN`, `PD_ANGEL_TOTP_SECRET` — Angel One SmartAPI
- `PD_TELEGRAM_BOT_TOKEN`, `PD_TELEGRAM_BOT_USERNAME` — optional, for alert notifications
- `PD_ADMIN_KEY` — protects maintenance endpoints (leave unset only for local dev)

### 3. Run

```
Start Apache in the XAMPP Control Panel
→ open http://localhost/paperdesk/
```

The `pd_users` table (and other app tables) are created automatically on
first use — nothing to run manually in the Neon console.

To keep orders filling in the background, run the matching engine
separately:

```bash
C:\xampp\php\php.exe cli\order-engine.php
```

(or register it as an always-on Windows Task Scheduler task — see
`cli/order-engine.php` for the exact setup).

Full step-by-step instructions — including Google Sign-In and SMTP setup
walkthroughs — are in **[SETUP.md](./SETUP.md)**.

<br>

## 🔐 Security Notes

- Secrets live only in `api/.env` (git-ignored); the app refuses to boot
  without a real `PD_JWT_SECRET` (≥32 chars) — no insecure shared default.
- CORS is an explicit allow-list (`PD_ALLOWED_ORIGINS`), not a wildcard.
- Auth uses a JWT bearer token in `sessionStorage`, not cookies — no ambient
  credential means no separate CSRF-token mechanism is needed.
- Failed logins are rate-limited (5 attempts → 15-minute lockout per email).
- Security-relevant events (login, signup, Google sign-in, password reset,
  trade execution) are recorded in an audit log.
- Admin/maintenance endpoints (instrument import/export, broker
  connectivity test) are gated behind `PD_ADMIN_KEY`.
- API requests are auto-redirected to HTTPS in production (skipped on
  localhost for local dev).

<br>

## 📄 Documentation

A full user-facing guide is included at
[`assets/docs/PaperDesk-User-Guide.pdf`](./assets/docs/PaperDesk-User-Guide.pdf).

<br>

## ⚠️ Disclaimer

PaperDesk is a **paper-trading simulator** — no real orders are placed with
any broker and no real money is involved.
