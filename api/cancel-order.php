<?php
// ── api/cancel-order.php ────────────────────────────────────────────
// POST { orderId } -> cancels a PENDING or TRIGGERED order belonging
// to the logged-in user. No-op safe: if the engine already filled it
// a split-second earlier, this correctly reports it can't be
// cancelled anymore instead of silently doing nothing.
require_once __DIR__ . '/config.php';
ensureTable();

$userId = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$body    = jsonBody();
$orderId = trim($body['orderId'] ?? '');
if ($orderId === '') respond(['error' => 'Missing orderId'], 400);

$db = getDB();

// Atomic claim-and-cancel: only succeeds if it's still PENDING/TRIGGERED,
// preventing a race where the engine fills it in the same instant.
$stmt = $db->prepare(
    "UPDATE pd_orders
     SET status = 'CANCELLED', cancelled_at = NOW()
     WHERE id = ? AND user_id = ? AND status IN ('PENDING','TRIGGERED')
     RETURNING id"
);
$stmt->execute([$orderId, $userId]);

if (!$stmt->fetch()) {
    respond(['error' => 'This order can no longer be cancelled (already filled or cancelled).'], 409);
}

respond(['message' => 'Order cancelled.']);
