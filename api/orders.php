<?php
// ── api/orders.php ──────────────────────────────────────────────────
// GET -> orders for the logged-in user, most recent first. Includes
// PENDING/TRIGGERED orders (still waiting on order-engine.php)
// alongside EXECUTED/CANCELLED/REJECTED ones.
//
// By default this returns only TODAY's orders — that's what the
// Orders tab wants (a same-day order book that empties out the next
// day, once fills have been swept into Positions/Portfolio). Pass
// ?scope=all to get full history instead, which is what Reports
// (TradeBook, Portfolio Analyser) and the Portfolio/Positions PDF
// exports need — they aggregate/plot data over all time, not just
// today.
require_once __DIR__ . '/config.php';
ensureTable();

$userId = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

$fullHistory = ($_GET['scope'] ?? '') === 'all';

// `created_at` is TIMESTAMPTZ; comparing against CURRENT_DATE compares
// in the DB server's date, so "today" means the same day for every
// request regardless of the visitor's local clock/timezone.
$sql = "SELECT id, symbol, exch, side, qty, price, order_type, limit_price, trigger_price,
               status, executed_price, executed_at, realized_pnl, created_at
        FROM pd_orders
        WHERE user_id = ?" . ($fullHistory ? '' : ' AND created_at::date = CURRENT_DATE') . "
        ORDER BY created_at DESC LIMIT 500";
$stmt = getDB()->prepare($sql);
$stmt->execute([$userId]);
respond(['orders' => $stmt->fetchAll()]);
