<?php
// ── api/telegram-link.php ─────────────────────────────────────────
// GET  -> whether this account currently has Telegram linked
// POST ?action=generate_link -> creates a one-time deep-link code;
//   the frontend opens https://t.me/<bot>?start=<code>, the user
//   taps Start in Telegram, and order-engine.php's poller matches
//   the resulting /start message back to this user automatically.
require_once __DIR__ . '/telegram-config.php';
ensureTable();

$userId = requireAuth();
$db     = getDB();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $db->prepare('SELECT telegram_chat_id FROM pd_users WHERE id = ?');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    respond(['linked' => !empty($row['telegram_chat_id']), 'chat_id' => $row['telegram_chat_id'] ?? null]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$action = $_GET['action'] ?? null;

if ($action === 'generate_link') {
    if (TELEGRAM_BOT_USERNAME === 'YOUR_BOT_USERNAME_HERE') {
        respond(['error' => 'Telegram bot is not configured yet on the server side.'], 500);
    }

    // Short, URL-safe, hard-to-guess code. 15 minute expiry — if the
    // user never clicks it, the code is just dead weight, no harm.
    $code = bin2hex(random_bytes(12));
    $expiresAt = date('Y-m-d H:i:s', time() + 900);

    $db->prepare('UPDATE pd_users SET telegram_link_code = ?, telegram_link_expires_at = ? WHERE id = ?')
       ->execute([$code, $expiresAt, $userId]);

    respond([
        'deepLink' => 'https://t.me/' . TELEGRAM_BOT_USERNAME . '?start=' . $code,
    ]);
}

respond(['error' => 'Unknown or missing action.'], 400);
