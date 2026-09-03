<?php
// ── api/positions.php ────────────────────────────────────────────
// GET -> today's open POSITIONS for the logged-in user — the
// intraday-qty portion of each holding that was bought today and
// hasn't been sold yet. If not sold by end of day, it silently
// becomes part of the Portfolio (api/holdings.php) the next time
// this user's holdings are touched, via rolloverHoldings().
require_once __DIR__ . '/config.php';
ensureTable();

$userId = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

rolloverHoldings(getDB(), $userId);

$stmt = getDB()->prepare(
    'SELECT symbol, exch, today_qty AS qty, avg_price
     FROM pd_holdings
     WHERE user_id = ? AND today_qty > 0
     ORDER BY updated_at DESC'
);
$stmt->execute([$userId]);
respond(['positions' => $stmt->fetchAll()]);
