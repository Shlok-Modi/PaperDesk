# PaperDesk — XAMPP Setup Guide

## Step 1 — Copy files to XAMPP

Copy the entire `paperdesk/` folder into your XAMPP `htdocs`:

```
C:\xampp\htdocs\paperdesk\
```

Your folder structure should look like:
```
htdocs/
└── paperdesk/
    ├── index.html
    ├── login.html
    ├── portfolio.html
    ├── style.css
    ├── login.css
    ├── script.js
    ├── login.js
    └── api/
        ├── config.php
        ├── signup.php
        ├── login.php
        ├── google-login.php
        └── me.php
```

## Step 2 — Enable PostgreSQL in PHP

1. Open **XAMPP Control Panel**
2. Click **Config** next to Apache → **PHP (php.ini)**
3. Search for `extension=pgsql` — remove the `;` at the start to uncomment it
4. Also uncomment `extension=pdo_pgsql` (needed for some systems)
5. **Save** the file
6. Click **Stop** then **Start** on Apache to restart

To verify it worked, create a file `C:\xampp\htdocs\test.php`:
```php
<?php phpinfo(); ?>
```
Open http://localhost/test.php and search for "pgsql" — you should see a green table.

## Step 3 — Start Apache

In XAMPP Control Panel, click **Start** next to Apache.

## Step 4 — Open PaperDesk

Go to: **http://localhost/paperdesk/**

That's it. No Node.js, no npm, no terminal needed.

---

## Custom error pages

`404.html` and `500.html` are branded fallback pages, wired up via
`.htaccess` (`ErrorDocument 404` / `500` / `503`). If you deploy
PaperDesk somewhere other than `/paperdesk/` (e.g. the domain root,
or a different subfolder), update the paths inside `.htaccess`
accordingly — they're hardcoded to `/paperdesk/404.html` and
`/paperdesk/500.html` to match this guide's folder layout.

Note: `api/*.php` endpoints always return JSON error responses
directly (see `respond()` in `api/config.php`) and are unaffected by
these pages — `500.html` only shows up for an actual server-level
crash (e.g. a PHP fatal error with no handler, or Apache itself
misconfigured), not for normal API error handling.

---

## How it works

```
Browser  →  http://localhost/paperdesk/index.html   (Apache serves HTML/CSS/JS)
              ↓ fetch('api/login.php')
           http://localhost/paperdesk/api/login.php   (PHP handles auth)
              ↓ pg_connect(...)
           Neon DB (PostgreSQL)                        (stores users)
```

The `pd_users` table is created automatically on the first signup — nothing
to run in phpMyAdmin or Neon console.

---

## Step 5 — Configure OTP email (forgot password)

Forgot-password now emails a 6-digit code via SMTP (using the bundled
PHPMailer library in `api/PHPMailer/`). Open `api/config.php` and fill in:

```php
define('SMTP_HOST', 'smtp.gmail.com');
define('SMTP_PORT', 587);
define('SMTP_USER', 'youraddress@gmail.com');
define('SMTP_PASS', 'your-16-char-app-password');
define('SMTP_FROM', 'youraddress@gmail.com');
define('SMTP_FROM_NAME', 'PaperDesk');
```

**Using Gmail:**
1. Turn on 2-Step Verification on the Google account: https://myaccount.google.com/security
2. Generate an App Password: https://myaccount.google.com/apppasswords (choose "Mail" / "Other")
3. Use that 16-character password as `SMTP_PASS` — not the normal Gmail password.

Any other SMTP provider (Brevo, Resend, Mailgun, SES, Outlook) works the same
way — just change `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS`.

**Flow:** `forgot-password.html` (enter email) → `verify-otp.html` (enter the
6-digit code emailed to you, expires in 10 min, 5 attempts max) →
`reset-password.html` (set new password). The OTP and the final reset step
are both server-verified — the browser never sees anything it could reuse to
skip a step.

If you see "Could not send the email right now" — check Apache's error log
(`C:\xampp\apache\logs\error.log`) for the underlying SMTP error (wrong
password, blocked port 587, etc).

## Step 6 — Configure Google Sign-In

PaperDesk supports "Sign in with Google" as an alternative to email/password,
using Google Identity Services (no server-side library needed).

**1. Create a Google OAuth Client ID**
1. Go to https://console.cloud.google.com/apis/credentials (create a project first if you don't have one)
2. Click **Create Credentials → OAuth client ID**
3. If prompted, configure the **OAuth consent screen** first — choose "External", fill in an app name/support email, and add your own email as a test user (this is enough while testing; only needed for verification once you go live with many users)
4. Application type: **Web application**
5. Under **Authorized JavaScript origins**, add:
   - `http://localhost` (XAMPP dev)
   - Your production domain, e.g. `https://paperdesk.example.com`
6. Click **Create** — copy the **Client ID** (looks like `123456-abc.apps.googleusercontent.com`)

**2. Paste the Client ID in two places** (must match exactly):
```php
// api/config.php
define('GOOGLE_CLIENT_ID', 'YOUR_CLIENT_ID.apps.googleusercontent.com');
```
```js
// login.js
const GOOGLE_CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
```

**3. That's it** — open `login.html`, the "Sign in with Google" button renders
above the email/password form.

**How it works:**
```
Browser → Google Identity Services popup → user picks their Google account
        → Google returns a signed ID token to login.js
        → fetch('api/google-login.php', { credential: idToken })
        → PHP verifies the token with Google (tokeninfo endpoint)
        → finds/creates the pd_users row, issues a normal PaperDesk JWT
```

Everything downstream (orders, portfolio, watchlists) is unaffected — Google
sign-in just produces the same JWT that email/password login does.

**Account linking:** if someone signs up with email/password and later uses
"Sign in with Google" with the same email, PaperDesk links the Google ID to
the existing account automatically rather than creating a duplicate.
Google-only accounts (no password set) have `password_hash = NULL` and
`auth_provider = 'google'` in `pd_users` — they can still use "Forgot
password" later to add a password if they want a second way in.

**Note:** Google Identity Services requires a real origin (`http://localhost`
works, `file://` does not) — same requirement as the rest of the app.

## Security Notes

**Secrets live in `api/.env`, not in code.** Copy `api/.env.example` to
`api/.env` and fill in real values (DB creds, SMTP creds, JWT secret,
Google client ID). `api/.env` is gitignored — never commit it.
Generate `PD_JWT_SECRET` with:
```
php -r "echo bin2hex(random_bytes(32));"
```
**`PD_JWT_SECRET` is now required** (must be set and at least 32
characters) — `config.php` refuses to boot without it. There is
intentionally no built-in fallback value: a shared default secret
would let anyone forge a valid login token for any user, so a missing
`.env` fails loudly instead of silently running insecurely.

**CORS is an explicit allow-list, not `*`.** Set `PD_ALLOWED_ORIGINS`
in `.env` to a comma-separated list of the exact frontend origin(s)
that are allowed to call this API (e.g.
`https://paperdesk.app,https://www.paperdesk.app`). Only requests
whose `Origin` header matches the list get `Access-Control-Allow-Origin`
echoed back; everything else is denied by the browser. If unset, it
falls back to common localhost dev ports — fine for local development,
but set it explicitly before deploying.

**CSRF:** PaperDesk uses a JWT bearer token stored in `sessionStorage`
and sent via the `Authorization` header — there's no cookie holding
credentials, so the browser never attaches auth automatically to a
cross-site request. This design removes the CSRF attack vector by
construction (no ambient credential for a forged request to ride on),
which is why there's no separate CSRF-token mechanism.

**Cookies / `session_regenerate_id()`:** the same JWT design means
PHP sessions and cookies aren't part of the auth flow, so these two
checklist items don't apply here. "Log out on browser close" is
handled instead by using `sessionStorage` (cleared automatically when
the tab/browser closes) rather than `localStorage`.

**Login rate limiting:** failed logins are tracked in
`pd_login_attempts`; an email is locked out for 15 minutes after 5
failed attempts (`isLoginLocked()` / `recordLoginAttempt()` in
`config.php`).

**Audit log:** security-relevant events (login success/failure,
signup, Google sign-in, password reset, trade execution) are recorded
in `pd_audit_log` via `auditLog()`.

**HTTPS:** API requests are redirected to HTTPS automatically in
production (skipped on `localhost`/`127.0.0.1` for local dev). Deploy
behind a real TLS certificate — XAMPP's default HTTP setup is for
local development only.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Database connection failed" | Uncomment `extension=pgsql` in php.ini, restart Apache |
| Blank page on login | Open browser DevTools → Console for errors |
| "CORS error" | Make sure you're opening via `http://localhost/paperdesk/` not `file://` |
| PHP shows as plain text | Apache isn't running, or file is outside htdocs |
