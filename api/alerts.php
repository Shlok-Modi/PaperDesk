<?php
// ── api/alerts.php ─────────────────────────────────────────────────
// GET                    -> list this user's alerts (active + history)
// POST ?action=create    { symbol, exch, direction, trigger_price }
// POST ?action=delete    { id }
require_once __DIR__ . '/config.php';
ensureTable();

$userId = requireAuth();
$db     = getDB();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;

if ($method === 'GET') {
    $stmt = $db->prepare(
        'SELECT id, symbol, exch, direction, trigger_price, status, created_at, triggered_at
         FROM pd_price_alerts WHERE user_id = ? ORDER BY created_at DESC'
    );
    $stmt->execute([$userId]);
    respond(['alerts' => $stmt->fetchAll()]);
}

if ($method !== 'POST') respond(['error' => 'Method not allowed'], 405);

$body = jsonBody();

if ($action === 'create') {
    // Telegram must be linked before an alert can ever actually reach the user
    $u = $db->prepare('SELECT telegram_chat_id FROM pd_users WHERE id = ?');
    $u->execute([$userId]);
    if (empty($u->fetch()['telegram_chat_id'])) {
        respond(['error' => 'Link your Telegram account first (see Profile settings) before creating alerts.'], 400);
    }

    $symbol    = strtoupper(trim($body['symbol'] ?? ''));
    $exch      = strtoupper(trim($body['exch'] ?? 'NSE'));
    $direction = strtoupper(trim($body['direction'] ?? ''));
    $price     = (float) ($body['trigger_price'] ?? 0);

    if ($symbol === '' || !preg_match('/^[A-Z0-9._-]{1,32}$/', $symbol)
        || !preg_match('/^[A-Z]{1,10}$/', $exch)
        || !in_array($direction, ['ABOVE', 'BELOW'], true) || $price <= 0) {
        respond(['error' => 'symbol, direction (ABOVE/BELOW), and a positive trigger_price are required.'], 400);
    }

    $inst = $db->prepare('SELECT 1 FROM pd_instruments WHERE symbol = ? AND exch = ?');
    $inst->execute([$symbol, $exch]);
    if (!$inst->fetch()) respond(['error' => 'Unknown instrument: ' . htmlspecialchars($symbol, ENT_QUOTES, 'UTF-8') . ' on ' . htmlspecialchars($exch, ENT_QUOTES, 'UTF-8')], 404);

    $activeCount = $db->prepare("SELECT COUNT(*) AS c FROM pd_price_alerts WHERE user_id = ? AND status = 'ACTIVE'");
    $activeCount->execute([$userId]);
    if ((int) $activeCount->fetch()['c'] >= 20) {
        respond(['error' => 'Maximum of 20 active alerts at a time.'], 400);
    }

    $stmt = $db->prepare(
        'INSERT INTO pd_price_alerts (user_id, symbol, exch, direction, trigger_price)
         VALUES (?, ?, ?, ?, ?) RETURNING id, symbol, exch, direction, trigger_price, status, created_at'
    );
    $stmt->execute([$userId, $symbol, $exch, $direction, $price]);
    respond(['alert' => $stmt->fetch()]);
}

if ($action === 'delete') {
    $id = $body['id'] ?? '';
    if (!$id) respond(['error' => 'id is required.'], 400);

    $stmt = $db->prepare("UPDATE pd_price_alerts SET status = 'CANCELLED' WHERE id = ? AND user_id = ?");
    $stmt->execute([$id, $userId]);
    respond(['message' => 'Alert cancelled.']);
}

respond(['error' => 'Unknown or missing action.'], 400);
