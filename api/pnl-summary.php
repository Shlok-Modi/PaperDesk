<?php
// ── api/pnl-summary.php ─────────────────────────────────────────────
// GET -> realized P&L summary for the logged-in user. Unrealized P&L
// is NOT computed here — that already lives client-side in
// portfolio.js (needs live LTP, which the frontend already polls).
// This endpoint only covers what's actually settled: money already
// locked in from past sells.
require_once __DIR__ . '/config.php';
ensureTable();

$userId = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

$db = getDB();

$stmt = $db->prepare(
    "SELECT
        COALESCE(SUM(realized_pnl), 0) AS total_realized,
        COALESCE(SUM(realized_pnl) FILTER (WHERE executed_at::date = CURRENT_DATE), 0) AS today_realized,
        COUNT(*) FILTER (WHERE realized_pnl IS NOT NULL) AS sell_count,
        COALESCE(SUM(qty * COALESCE(executed_price, price)) FILTER (WHERE realized_pnl IS NOT NULL), 0) AS total_sell_value
     FROM pd_orders
     WHERE user_id = ? AND status = 'EXECUTED' AND realized_pnl IS NOT NULL"
);
$stmt->execute([$userId]);
$row = $stmt->fetch();

respond([
    'totalRealized'  => (float) $row['total_realized'],
    'todayRealized'  => (float) $row['today_realized'],
    'sellCount'      => (int) $row['sell_count'],
    // Cost basis of the shares that generated this realized P&L, derived
    // as (sell proceeds - realized P&L). Lets the frontend show a %
    // return on Realized P&L without a separate cost-basis column.
    'totalSellValue' => (float) $row['total_sell_value'],
]);
