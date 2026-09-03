<?php
// ── api/holdings.php ──────────────────────────────────────────────
// GET -> ALL current holdings for the logged-in user (symbol, exch,
// qty, avg_price, today_qty). `qty` is the TOTAL held (today's buys
// included) — this is what the trade modal uses to cap "available to
// sell", so a share bought minutes ago can still be squared off the
// same day. `today_qty` tells consumers how much of that qty was
// bought today; the Portfolio page subtracts it to show only
// carried-forward holdings (today's buys live on the Positions tab
// instead, via api/positions.php).
require_once __DIR__ . '/config.php';
ensureTable();

$userId = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

rolloverHoldings(getDB(), $userId);

$stmt = getDB()->prepare(
    'SELECT symbol, exch, qty, avg_price, today_qty
     FROM pd_holdings WHERE user_id = ? ORDER BY updated_at DESC'
);
$stmt->execute([$userId]);
respond(['holdings' => $stmt->fetchAll()]);
