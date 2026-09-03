<?php
// ── api/config.php ────────────────────────────────────────────────

// ── ENV LOADING ───────────────────────────────────────────────────
// Loads api/.env (KEY=VALUE per line, # comments allowed) into
// $_ENV/getenv() if present. Secrets live in .env (gitignored) —
// nothing sensitive is hardcoded below anymore. See SETUP.md.
(function () {
    $envFile = __DIR__ . '/.env';
    if (!is_file($envFile)) return;
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) continue;
        [$key, $value] = explode('=', $line, 2);
        $key   = trim($key);
        $value = trim($value, " \t\n\r\0\x0B\"'");
        if ($key !== '' && getenv($key) === false) {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
})();

/**
 * Gates admin/maintenance scripts (instrument import, exports, broker
 * connectivity tests) that can't use requireAuth() because they're
 * meant to be triggered by cron with no logged-in user. Requires a
 * shared secret via ?key=... or the X-Admin-Key header, set once in
 * .env as PD_ADMIN_KEY. If PD_ADMIN_KEY isn't set, these scripts stay
 * open (matches previous behaviour) — set it in production.
 */
function requireAdminKey(): void {
    $expected = env('PD_ADMIN_KEY', '');
    if ($expected === '') return; // not configured — leave open (dev default)
    $given = $_GET['key'] ?? ($_SERVER['HTTP_X_ADMIN_KEY'] ?? '');
    if (!hash_equals($expected, (string) $given)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Forbidden.']);
        exit;
    }
}


function env(string $key, string $default = ''): string {
    $val = getenv($key);
    return $val !== false ? $val : $default;
}

/**
 * Mandatory password policy, shared by signup.php and reset-password.php
 * so both endpoints enforce identical rules (the frontend checklist in
 * login.js / reset-password.js mirrors this for live feedback, but that
 * JS can always be bypassed — this is the check that actually matters).
 * Returns null if the password passes, or a user-facing error string
 * naming the first unmet requirement.
 */
function validatePasswordPolicy(string $password): ?string {
    if (strlen($password) < 8) return 'Password must be at least 8 characters.';
    if (!preg_match('/[A-Z]/', $password)) return 'Password must contain at least one uppercase letter.';
    if (!preg_match('/[0-9]/', $password)) return 'Password must contain at least one number.';
    if (!preg_match('/[^A-Za-z0-9]/', $password)) return 'Password must contain at least one special character.';
    return null;
}

/**
 * NSE/BSE cash market hours: Mon-Fri, 9:15 AM - 3:30 PM IST.
 * This doesn't account for exchange holidays (that needs a holiday
 * calendar Angel One doesn't expose via a simple endpoint) — but it
 * correctly handles the common case: weekends and outside trading hours.
 * Shared by indices.php (to show open/closed status) and trade.php
 * (to actually block order placement while the market is shut).
 */
function isMarketOpen(): bool {
    $ist = new DateTime('now', new DateTimeZone('Asia/Kolkata'));
    $dow = (int) $ist->format('N'); // 1 = Monday ... 7 = Sunday
    if ($dow >= 6) return false;    // Sat/Sun closed

    $minutesNow = ((int) $ist->format('H')) * 60 + (int) $ist->format('i');
    $open  = 9 * 60 + 15;  // 9:15 AM
    $close = 15 * 60 + 30; // 3:30 PM
    return $minutesNow >= $open && $minutesNow <= $close;
}



// ── ERROR HANDLING ────────────────────────────────────────────────
// Prevent PHP from ever printing raw HTML warnings/errors into what
// should be a pure JSON response (this is what caused the
// "Unexpected token '<'..." errors). Errors are logged instead, and
// any uncaught fatal is converted into a clean JSON response.
ini_set('display_errors', '0');
error_reporting(E_ALL);

register_shutdown_function(function () {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        if (!headers_sent()) {
            header('Content-Type: application/json');
            http_response_code(500);
        }
        echo json_encode(['error' => 'Server error: ' . $err['message']]);
    }
});

// Everything below this point (security headers, HTTPS redirect,
// CORS) only makes sense for an actual HTTP request. This file is
// also require'd by CLI scripts (cli/order-engine.php via
// angel-config.php/telegram-config.php) which have no $_SERVER
// request data — e.g. $_SERVER['SERVER_NAME'] is unset in CLI, so
// the HTTPS-enforcement block below used to think every CLI run was
// a non-local plaintext request and would `header('Location: ...');
// exit;` — a no-op header() but a very real exit(), silently killing
// the order engine right after it loaded config.php. Skip all of it
// in CLI so these scripts can keep running.
if (PHP_SAPI !== 'cli') {

// ── SECURITY HEADERS ─────────────────────────────────────────────
// Applied to every API response. CSP is deliberately conservative
// since this endpoint only ever emits JSON (never HTML), so a very
// tight default-src is safe and doesn't need per-page tuning.
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
if ((($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') {
    // Only sent over an actual HTTPS connection — sending it over
    // plain HTTP is a no-op and can be confusing in local dev.
    header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
}

// ── HTTPS ENFORCEMENT ────────────────────────────────────────────
// Redirect any plain-HTTP API request to HTTPS before doing anything
// else. Skipped automatically on localhost/127.0.0.1 so local dev
// (which usually has no TLS cert) keeps working.
$isHttps    = (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
$isLocalDev = in_array($_SERVER['SERVER_NAME'] ?? '', ['localhost', '127.0.0.1'], true);
if (!$isHttps && !$isLocalDev) {
    $redirectUrl = 'https://' . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? '');
    header('Location: ' . $redirectUrl, true, 301);
    exit;
}

// ── CORS ──────────────────────────────────────────────────────────

// Wildcard "*" is deliberately NOT used: this API accepts an
// Authorization: Bearer header, and a wildcard would let any origin
// that has (or obtains, e.g. via an unrelated XSS bug) a copy of a
// user's token call the API from a browser context we don't control.
// Only origins we explicitly trust get the header back, and it's
// echoed (not wildcarded) so browsers will actually honour it.
//
// Configure via PD_ALLOWED_ORIGINS in .env, comma-separated, e.g.:
//   PD_ALLOWED_ORIGINS=https://paperdesk.app,https://www.paperdesk.app
// Falls back to common local-dev origins if unset.
$__allowedOrigins = array_filter(array_map('trim', explode(',', env(
    'PD_ALLOWED_ORIGINS',
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500'
))));
$__origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($__origin !== '' && in_array($__origin, $__allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $__origin);
    header('Vary: Origin');
}
header('Content-Type: application/json');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
unset($__allowedOrigins, $__origin);

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

} // end if (PHP_SAPI !== 'cli')

// ── HOLDINGS DAY ROLLOVER (Positions -> Portfolio) ─────────────────
// Any row in pd_holdings whose `today_date` isn't today still has
// its `today_qty` counted as "bought today" (i.e. it belongs on the
// Positions tab). The very first time that user's holdings are
// touched on a new calendar day — via a GET to holdings.php/
// positions.php, or a fresh trade — this resets today_qty back to 0
// for every stale row in one cheap UPDATE, which is exactly
// equivalent to "last night's open positions became today's
// portfolio," with no cron/background job required.
function rolloverHoldings(PDO $db, string $userId): void {
    $db->prepare(
        "UPDATE pd_holdings
         SET today_qty = 0, today_date = CURRENT_DATE
         WHERE user_id = ? AND (today_date IS DISTINCT FROM CURRENT_DATE) AND today_qty <> 0"
    )->execute([$userId]);
}

// ── NEON DB ───────────────────────────────────────────────────────
function getDB(): PDO {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    $dbHost     = env('PD_DB_HOST', 'YOUR_NEON_HOST_HERE');
    $dbEndpoint = env('PD_DB_ENDPOINT_ID', 'YOUR_ENDPOINT_ID_HERE');
    $dbUser     = env('PD_DB_USER', 'neondb_owner');
    $dbPass     = env('PD_DB_PASSWORD', 'YOUR_DB_PASSWORD_HERE');
    $dsn = "pgsql:host=$dbHost;port=5432;dbname=neondb;sslmode=require;options=endpoint=$dbEndpoint";

    try {
        $pdo = new PDO($dsn, $dbUser, $dbPass, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT            => 10,
        ]);
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'DB connection failed: ' . $e->getMessage()]);
        exit;
    }
    return $pdo;
}

// ── INIT TABLE ────────────────────────────────────────────────────
function ensureTable(): void {
    // ── FAST PATH ─────────────────────────────────────────────────
    // The ~30 CREATE TABLE/ALTER TABLE statements below are all
    // idempotent (IF NOT EXISTS / IF NOT EXISTS column guards), so
    // running them on *every* request is safe but wasteful: each
    // one is a separate round-trip to Neon, and Neon's serverless
    // Postgres adds real latency to the first query after any idle
    // period (cold start / connection re-establish). On a request
    // that also does bcrypt hashing and sends an email afterwards
    // (signup.php), that stacked latency can push the request close
    // to the PHP/webserver execution-time limit, causing the SMTP
    // send at the *end* of the request to fail or get cut off —
    // while a lighter request (like resend-signup-otp.php) sails
    // through fine. That's why "resend" can succeed when the
    // original signup email silently didn't send.
    //
    // Fix: cache "schema already initialized" in a marker file for
    // a few minutes so repeat requests skip straight past this and
    // go do their actual work (and send mail) immediately.
    $marker    = sys_get_temp_dir() . '/pd_schema_ready';
    $cacheTtl  = 300; // seconds
    if (is_file($marker) && (time() - filemtime($marker)) < $cacheTtl) {
        return;
    }

    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_users (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name          TEXT NOT NULL,
            email         TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            balance       NUMERIC(18,2) NOT NULL DEFAULT 1000000.00,
            dob           DATE,
            gender        TEXT,
            created_at    TIMESTAMPTZ DEFAULT NOW(),
            updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
    ");
    // Safe to run repeatedly — no-ops if columns already exist
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS dob DATE");
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS gender TEXT");
    // Table pre-dates the nullable password_hash column definition above —
    // this drops the old NOT NULL constraint on existing databases (no-op
    // if already nullable).
    getDB()->exec("ALTER TABLE pd_users ALTER COLUMN password_hash DROP NOT NULL");
    // Google Sign-In support. auth_provider distinguishes password accounts
    // from Google-only accounts (which have password_hash = NULL). google_id
    // is Google's stable per-user 'sub' claim — used to look up the account
    // on subsequent logins without depending on email matching.
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE");
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password'");
    // Tracks the timestamp of the user's most recent successful sign-in
    // (password or Google) — set in api/login.php and
    // api/google-login.php, surfaced on the Profile page next to
    // "Member Since". NULL for accounts that haven't logged in since
    // this column was added (or somehow never logged in at all).
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ");
    // Email verification (signup OTP flow). Existing accounts (created
    // before this column existed) are grandfathered in as verified so
    // current users aren't suddenly locked out — only new signups go
    // through the OTP step. Google accounts are always TRUE since
    // Google already verified the email (see google-login.php).
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT TRUE");
    // Google profile photo URL — captured at Google sign-in time so the
    // navbar avatar can show the user's real picture instead of just
    // their initials. Password-only accounts simply leave this NULL,
    // and the frontend falls back to the initials circle as before.
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS picture_url TEXT");
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_password_resets (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES pd_users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            used       BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    ");
    // OTP-based reset flow. One row per request; otp_hash is checked in
    // verify-otp.php, and once verified, reset_token_hash is checked in
    // reset-password.php. Keeping both in one row prevents skipping the
    // OTP step by guessing a reset token straight away.
    // 'purpose' reuses this same table for signup email verification
    // (verify-signup-otp.php) as well as password reset, so both flows
    // share the same rate-limiting/attempt-capping logic.
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_otp_resets (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id          UUID NOT NULL REFERENCES pd_users(id) ON DELETE CASCADE,
            otp_hash         TEXT NOT NULL,
            otp_expires_at   TIMESTAMPTZ NOT NULL,
            attempts         INT NOT NULL DEFAULT 0,
            verified         BOOLEAN NOT NULL DEFAULT FALSE,
            reset_token_hash TEXT,
            reset_expires_at TIMESTAMPTZ,
            used             BOOLEAN NOT NULL DEFAULT FALSE,
            purpose          TEXT NOT NULL DEFAULT 'password_reset',
            created_at       TIMESTAMPTZ DEFAULT NOW()
        )
    ");
    getDB()->exec("ALTER TABLE pd_otp_resets ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'password_reset'");
    // Multiple watchlists per user (max 6, enforced in watchlists.php)
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_watchlists (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES pd_users(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            sort_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    ");
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_watchlist_items (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            watchlist_id UUID NOT NULL REFERENCES pd_watchlists(id) ON DELETE CASCADE,
            symbol       TEXT NOT NULL,
            exch         TEXT NOT NULL DEFAULT 'NSE',
            added_at     TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(watchlist_id, symbol)
        )
    ");
    // Full NSE/BSE instrument master (imported from Angel One's
    // OpenAPIScripMaster.json via import-instruments.php). This is
    // what powers symbol search for "+ Add" and live price lookups.
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_instruments (
            token       TEXT PRIMARY KEY,
            symbol      TEXT NOT NULL,
            name        TEXT NOT NULL,
            exch        TEXT NOT NULL,
            instrument_type TEXT,
            lot_size    INT,
            tick_size   NUMERIC(12,2),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    ");
    getDB()->exec("CREATE INDEX IF NOT EXISTS idx_instruments_symbol ON pd_instruments (symbol)");
    getDB()->exec("CREATE INDEX IF NOT EXISTS idx_instruments_name   ON pd_instruments (name)");

    // Caches the Angel One session (jwtToken/feedToken) so we don't
    // log in on every request — SmartAPI tokens are valid for a while
    // but should be refreshed periodically (see angel-auth.php).
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_angel_session (
            id          INT PRIMARY KEY DEFAULT 1,
            jwt_token   TEXT,
            feed_token  TEXT,
            refresh_token TEXT,
            logged_in_at TIMESTAMPTZ,
            CHECK (id = 1)
        )
    ");

    // Executed trades (market orders only, for now) and current
    // holdings per user — this is what actually moves virtual money
    // and builds the portfolio.
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_orders (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES pd_users(id) ON DELETE CASCADE,
            symbol     TEXT NOT NULL,
            exch       TEXT NOT NULL DEFAULT 'NSE',
            side       TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
            qty        INT NOT NULL,
            price      NUMERIC(14,2) NOT NULL DEFAULT 0,
            status     TEXT NOT NULL DEFAULT 'EXECUTED',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    ");
    // Safe to run repeatedly — no-ops if columns already exist.
    // order_type: MARKET (default, existing behaviour) | LIMIT | SL-M | SL-L
    // limit_price:   required for LIMIT and SL-L
    // trigger_price: required for SL-M and SL-L (the "stop" price)
    // status gains: PENDING (waiting), TRIGGERED (SL-L only, past
    // trigger, now waiting on limit_price), CANCELLED, REJECTED
    // executed_at / executed_price record what actually happened,
    // separate from price (which for pending orders holds the
    // limit/trigger the user requested, not a fill price).
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'MARKET'");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS limit_price NUMERIC(14,2)");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS trigger_price NUMERIC(14,2)");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS executed_price NUMERIC(14,2)");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ");
    getDB()->exec("CREATE INDEX IF NOT EXISTS idx_orders_pending ON pd_orders (status, symbol, exch) WHERE status IN ('PENDING','TRIGGERED')");
    // LIMIT/SL order support — orders that don't fill immediately.
    // order_type MARKET orders keep working exactly as before (price
    // = fill price, status EXECUTED immediately). LIMIT/SL-M/SL-L
    // orders start as PENDING with price=0 until order-watcher.php
    // (a standalone CLI process — see SETUP.md) fills them.
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'MARKET'");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS limit_price NUMERIC(14,2)");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS trigger_price NUMERIC(14,2)");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS triggered BOOLEAN NOT NULL DEFAULT FALSE");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ");
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS reject_reason TEXT");
    // Realized P&L for SELL fills only: (sell_price - avg_cost_at_time_of_sale) * qty.
    // NULL for BUY orders — a buy never "realizes" a gain/loss on its own.
    getDB()->exec("ALTER TABLE pd_orders ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC(14,2)");
    getDB()->exec("CREATE INDEX IF NOT EXISTS idx_orders_pending ON pd_orders (status) WHERE status = 'PENDING'");
    getDB()->exec("CREATE INDEX IF NOT EXISTS idx_orders_user ON pd_orders (user_id, created_at DESC)");

    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_holdings (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES pd_users(id) ON DELETE CASCADE,
            symbol     TEXT NOT NULL,
            exch       TEXT NOT NULL DEFAULT 'NSE',
            qty        INT NOT NULL,
            avg_price  NUMERIC(14,2) NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, symbol, exch)
        )
    ");
    // Positions vs. Portfolio split: `today_qty` is how much of `qty`
    // was bought today (shows on the Positions tab); the rest —
    // `qty - today_qty` — is what's shown on the Portfolio tab.
    // `today_qty` is reset back to 0 the first time a user's holdings
    // are touched (read or written) on a new calendar day, which is
    // effectively an automatic overnight rollover with no cron job
    // needed — see rolloverHoldings() below.
    getDB()->exec("ALTER TABLE pd_holdings ADD COLUMN IF NOT EXISTS today_qty INT NOT NULL DEFAULT 0");
    getDB()->exec("ALTER TABLE pd_holdings ADD COLUMN IF NOT EXISTS today_date DATE");

    // Telegram alerts — link a Telegram chat to the account, and
    // let users set price alerts that get pushed there.
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT");

    // One-time deep-link codes for auto-linking: user clicks a
    // t.me/YourBot?start=<code> link, order-engine.php's Telegram
    // poller sees the resulting /start message and matches the code
    // back to this user — no manual chat-ID lookup needed.
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS telegram_link_code TEXT");
    getDB()->exec("ALTER TABLE pd_users ADD COLUMN IF NOT EXISTS telegram_link_expires_at TIMESTAMPTZ");

    // Tracks the last Telegram update_id we've processed, so the
    // engine's getUpdates poll never re-processes the same /start
    // message twice across restarts.
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_telegram_state (
            id             INT PRIMARY KEY DEFAULT 1,
            last_update_id BIGINT NOT NULL DEFAULT 0,
            CHECK (id = 1)
        )
    ");

    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_price_alerts (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id       UUID NOT NULL REFERENCES pd_users(id) ON DELETE CASCADE,
            symbol        TEXT NOT NULL,
            exch          TEXT NOT NULL DEFAULT 'NSE',
            direction     TEXT NOT NULL CHECK (direction IN ('ABOVE','BELOW')),
            trigger_price NUMERIC(14,2) NOT NULL,
            status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','TRIGGERED','CANCELLED')),
            created_at    TIMESTAMPTZ DEFAULT NOW(),
            triggered_at  TIMESTAMPTZ
        )
    ");
    getDB()->exec("CREATE INDEX IF NOT EXISTS idx_alerts_active ON pd_price_alerts (status) WHERE status = 'ACTIVE'");

    // ── LOGIN RATE LIMITING ─────────────────────────────────────────
    // One row per login attempt (success or failure). login.php checks
    // this before verifying a password and locks out after too many
    // failures within LOGIN_LOCKOUT_WINDOW_MIN.
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_login_attempts (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email      TEXT NOT NULL,
            ip         TEXT NOT NULL,
            success    BOOLEAN NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    ");
    getDB()->exec("CREATE INDEX IF NOT EXISTS idx_login_attempts_lookup ON pd_login_attempts (email, created_at DESC)");

    // ── AUDIT LOG ────────────────────────────────────────────────────
    // Append-only trail of security-relevant events (login, signup,
    // password reset, trades, Google sign-in, etc). user_id is
    // nullable since some events (failed login on unknown email)
    // happen before a user is identified.
    getDB()->exec("
        CREATE TABLE IF NOT EXISTS pd_audit_log (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID REFERENCES pd_users(id) ON DELETE SET NULL,
            event      TEXT NOT NULL,
            ip         TEXT,
            details    TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    ");
    getDB()->exec("CREATE INDEX IF NOT EXISTS idx_audit_log_user ON pd_audit_log (user_id, created_at DESC)");
    getDB()->exec("CREATE INDEX IF NOT EXISTS idx_audit_log_event ON pd_audit_log (event, created_at DESC)");

    // Schema is up to date — let subsequent requests (within $cacheTtl)
    // skip all of the above and get straight to real work.
    @touch($marker);
}

// ── RATE LIMITING ─────────────────────────────────────────────────
define('LOGIN_MAX_ATTEMPTS', 5);
define('LOGIN_LOCKOUT_WINDOW_MIN', 15);

/** Returns true if this email has too many recent failed logins to allow another attempt. */
function isLoginLocked(string $email): bool {
    $stmt = getDB()->prepare(
        "SELECT COUNT(*) AS c FROM pd_login_attempts
         WHERE email = ? AND success = FALSE AND created_at > NOW() - INTERVAL '" . LOGIN_LOCKOUT_WINDOW_MIN . " minutes'"
    );
    $stmt->execute([$email]);
    return (int) $stmt->fetch()['c'] >= LOGIN_MAX_ATTEMPTS;
}

/** Records a login attempt for rate-limiting; clears prior failures on success so the window resets. */
function recordLoginAttempt(string $email, bool $success): void {
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    // PDO's execute([...]) array form casts PHP `false` to an empty
    // string, which Postgres' boolean type rejects (SQLSTATE 22P02).
    // int (0/1) is safe and Postgres casts it correctly either way.
    getDB()->prepare('INSERT INTO pd_login_attempts (email, ip, success) VALUES (?, ?, ?)')
        ->execute([$email, $ip, (int) $success]);
    if ($success) {
        getDB()->prepare('DELETE FROM pd_login_attempts WHERE email = ? AND success = FALSE')->execute([$email]);
    }
}

// ── AUDIT LOGGING ─────────────────────────────────────────────────
/** Records a security-relevant event. Never throws — logging failures must not break the request. */
function auditLog(?string $userId, string $event, string $details = ''): void {
    try {
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        getDB()->prepare('INSERT INTO pd_audit_log (user_id, event, ip, details) VALUES (?, ?, ?, ?)')
            ->execute([$userId, $event, $ip, $details]);
    } catch (\Throwable $e) {
        error_log('auditLog failed: ' . $e->getMessage());
    }
}

// ── MAIL (SMTP via PHPMailer) ───────────────────────────────────────
// Fill these in with your real SMTP provider before going live.
// Gmail: smtp.gmail.com / 587 / your gmail address / a 16-char "App
// Password" (not your normal password — generate one at
// https://myaccount.google.com/apppasswords, requires 2FA enabled).
// Any transactional provider (Brevo, Resend, Mailgun, SES) works too.
define('SMTP_HOST', env('PD_SMTP_HOST', 'smtp.gmail.com'));
define('SMTP_PORT', (int) env('PD_SMTP_PORT', '587'));
define('SMTP_USER', env('PD_SMTP_USER', ''));
define('SMTP_PASS', env('PD_SMTP_PASS', ''));
define('SMTP_FROM', env('PD_SMTP_FROM', SMTP_USER));
define('SMTP_FROM_NAME', env('PD_SMTP_FROM_NAME', 'PaperDesk'));

require_once __DIR__ . '/PHPMailer/src/Exception.php';
require_once __DIR__ . '/PHPMailer/src/PHPMailer.php';
require_once __DIR__ . '/PHPMailer/src/SMTP.php';

/**
 * Sends an email via SMTP. Returns true on success, false on failure
 * (failure is logged with error_log, never shown to the client).
 */
function sendMail(string $toEmail, string $toName, string $subject, string $htmlBody): bool {
    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    try {
        $mail->isSMTP();
        $mail->Host       = SMTP_HOST;
        $mail->SMTPAuth   = true;
        $mail->Username   = SMTP_USER;
        $mail->Password   = SMTP_PASS;
        $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
        $mail->Port       = SMTP_PORT;

        $mail->setFrom(SMTP_FROM, SMTP_FROM_NAME);
        $mail->addAddress($toEmail, $toName);

        // Without this, PHPMailer defaults to ISO-8859-1, which mangles
        // any multi-byte UTF-8 characters — including the ₹ symbol and
        // the 📈/📉 emoji used in alert subjects/bodies — into garbled
        // text like "â‚¹" and "ðŸ“ˆ" in the recipient's inbox.
        $mail->CharSet = PHPMailer\PHPMailer\PHPMailer::CHARSET_UTF8;

        $mail->isHTML(true);
        $mail->Subject = $subject;
        $mail->Body    = $htmlBody;
        $mail->AltBody  = strip_tags($htmlBody);

        $mail->send();
        return true;
    } catch (\Throwable $e) {
        // $e->getMessage() alone is often just "SMTP Error: ..." or
        // "Mailer Error: ..." with no real detail. $mail->ErrorInfo
        // carries PHPMailer's actual reason (auth failure, connection
        // refused, recipient rejected, etc) — log both plus who/what
        // so failures are actually diagnosable instead of a black box.
        error_log(sprintf(
            'sendMail failed: to=%s subject="%s" exception="%s" ErrorInfo="%s"',
            $toEmail,
            $subject,
            $e->getMessage(),
            $mail->ErrorInfo ?? ''
        ));
        return false;
    }
}

/** Generates a cryptographically random 6-digit OTP as a string, e.g. "042917". */
function generateOtp(): string {
    return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

// ── JWT ───────────────────────────────────────────────────────────
// No fallback secret on purpose: a well-known default would let
// anyone forge a valid login token for any user if PD_JWT_SECRET is
// ever missing in production. Fail loudly instead of silently
// running with a public secret.
$__jwtSecret = env('PD_JWT_SECRET', '');
if ($__jwtSecret === '' || strlen($__jwtSecret) < 32) {
    http_response_code(500);
    header('Content-Type: application/json');
    error_log('FATAL: PD_JWT_SECRET is missing or too short (need >= 32 chars). Refusing to start.');
    echo json_encode(['error' => 'Server misconfiguration.']);
    exit;
}
define('JWT_SECRET', $__jwtSecret);
define('JWT_EXPIRY', 7 * 24 * 3600);
unset($__jwtSecret);

// ── GOOGLE SIGN-IN ───────────────────────────────────────────────
// Create this in Google Cloud Console → APIs & Services → Credentials
// → OAuth client ID → Web application. See SETUP.md for the full walkthrough.
define('GOOGLE_CLIENT_ID', env('PD_GOOGLE_CLIENT_ID', 'YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com'));

/**
 * Verifies a Google ID token (JWT) and returns its decoded payload, or null
 * if invalid. Checks against Google's tokeninfo endpoint rather than
 * verifying the signature locally — simplest correct approach without
 * pulling in a JWT/JWK library, and fine at PaperDesk's request volume.
 * Confirms both signature validity (Google does this) AND that the token
 * was issued for *this* app (aud check) — skipping the aud check would let
 * a token meant for a completely different Google app log into PaperDesk.
 */
function verifyGoogleToken(string $idToken): ?array {
    $url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($idToken);
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
    ]);
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($res === false || $code !== 200) return null;

    $payload = json_decode($res, true);
    if (!$payload || !isset($payload['sub'], $payload['email'])) return null;
    if ($payload['aud'] !== GOOGLE_CLIENT_ID) return null;
    if (($payload['email_verified'] ?? 'false') !== 'true') return null;

    return $payload;
}

function base64url_encode(string $data): string {
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}
function base64url_decode(string $data): string {
    return base64_decode(strtr($data, '-_', '+/'));
}
function generateJWT(string $userId): string {
    $header  = base64url_encode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $payload = base64url_encode(json_encode([
        'userId' => $userId,
        'iat'    => time(),
        'exp'    => time() + JWT_EXPIRY,
    ]));
    $sig = base64url_encode(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));
    return "$header.$payload.$sig";
}
function verifyJWT(string $token): ?array {
    $parts = explode('.', $token);
    if (count($parts) !== 3) return null;
    [$header, $payload, $sig] = $parts;
    $expected = base64url_encode(hash_hmac('sha256', "$header.$payload", JWT_SECRET, true));
    if (!hash_equals($expected, $sig)) return null;
    $data = json_decode(base64url_decode($payload), true);
    if (!$data || $data['exp'] < time()) return null;
    return $data;
}

// ── AUTH MIDDLEWARE ───────────────────────────────────────────────
// Apache + mod_php (the XAMPP default) often does NOT populate
// $_SERVER['HTTP_AUTHORIZATION'] even though the browser sent the
// header — it silently strips it unless CGIPassAuth/an .htaccess
// rewrite rule is configured. That makes every authenticated request
// look "logged out" right after a real, successful login. We check
// every place PHP might actually have put the header before giving up.
function getAuthorizationHeader(): string {
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        return $_SERVER['HTTP_AUTHORIZATION'];
    }
    // Some SAPIs/proxies rewrite it with a REDIRECT_ prefix.
    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    // Last resort: ask Apache directly for the raw request headers
    // (works even when $_SERVER strips Authorization).
    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) return $value;
        }
    }
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) return $value;
        }
    }
    return '';
}

function requireAuth(): string {
    $header = getAuthorizationHeader();
    if (!str_starts_with($header, 'Bearer ')) {
        http_response_code(401);
        echo json_encode(['error' => 'Not authenticated']);
        exit;
    }
    $token = substr($header, 7);
    $data  = verifyJWT($token);
    if (!$data) {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid or expired token']);
        exit;
    }
    return $data['userId'];
}

// ── HELPERS ───────────────────────────────────────────────────────
function jsonBody(): array {
    return json_decode(file_get_contents('php://input'), true) ?? [];
}
function safeUser(array $user): array {
    unset($user['password_hash']);
    $user['balance'] = (float) $user['balance'];
    return $user;
}
function respond(array $data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data);
    exit;
}
