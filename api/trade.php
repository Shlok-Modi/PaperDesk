<?php
// ── api/trade.php ──────────────────────────────────────────────────
// POST { symbol, exch, side, qty, order_type, limit_price, trigger_price }
//
// order_type: MARKET (default) | LIMIT | SL-M | SL-L
//   MARKET -> fills immediately at the current live price (unchanged
//             from before).
//   LIMIT  -> queued as PENDING; order-engine.php fills it once LTP
//             crosses limit_price in your favour.
//   SL-M   -> queued as PENDING; fills at current LTP once LTP
//             crosses trigger_price (a stop, not a target).
//   SL-L   -> queued as PENDING; once LTP crosses trigger_price it
//             becomes TRIGGERED (a live limit order), then fills once
//             LTP also crosses limit_price.
//
// The price is always fetched fresh server-side for MARKET orders
// (never trusted from the client) to prevent price manipulation via
// devtools/a modified request. For LIMIT/SL orders, no price is
// fetched here at all — the background engine decides when/at what
// price to fill, based on real live prices at that future moment.
require_once __DIR__ . '/angel-config.php';
require_once __DIR__ . '/order-lib.php';
ensureTable();

$userId = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

// ── Market-hours check ───────────────────────────────────────────
// This app doesn't support After Market Orders (AMO) — orders can
// only be placed while NSE/BSE cash market is actually open
// (Mon-Fri, 9:15 AM - 3:30 PM IST). Applies to every order_type,
// including LIMIT/SL-M/SL-L, not just MARKET — otherwise someone
// could queue a PENDING order overnight that the engine fills the
// moment the market reopens, which is exactly the AMO behaviour
// we're intentionally not offering.
if (!isMarketOpen()) {
    respond(['error' => 'Market is closed. Orders can only be placed Mon-Fri, 9:15 AM - 3:30 PM IST.'], 403);
}

$body         = jsonBody();
$symbol       = strtoupper(trim($body['symbol'] ?? ''));
$exch         = strtoupper(trim($body['exch'] ?? 'NSE'));
$side         = strtoupper(trim($body['side'] ?? ''));
$qty          = (int) ($body['qty'] ?? 0);
$orderType    = strtoupper(trim($body['order_type'] ?? 'MARKET'));
$limitPrice   = isset($body['limit_price'])   ? (float) $body['limit_price']   : null;
$triggerPrice = isset($body['trigger_price']) ? (float) $body['trigger_price'] : null;

if ($symbol === '' || !preg_match('/^[A-Z0-9._-]{1,32}$/', $symbol)
    || !preg_match('/^[A-Z]{1,10}$/', $exch)
    || !in_array($side, ['BUY', 'SELL'], true) || $qty < 1) {
    respond(['error' => 'symbol, side (BUY/SELL), and a valid qty are required.'], 400);
}
if (!in_array($orderType, ['MARKET', 'LIMIT', 'SL-M', 'SL-L'], true)) {
    respond(['error' => 'Invalid order_type.'], 400);
}
if (in_array($orderType, ['LIMIT', 'SL-L'], true) && (!$limitPrice || $limitPrice <= 0)) {
    respond(['error' => 'limit_price is required for LIMIT and SL-L orders.'], 400);
}
if (in_array($orderType, ['SL-M', 'SL-L'], true) && (!$triggerPrice || $triggerPrice <= 0)) {
    respond(['error' => 'trigger_price is required for SL-M and SL-L orders.'], 400);
}

$db = getDB();

$stmt = $db->prepare('SELECT token FROM pd_instruments WHERE symbol = ? AND exch = ?');
$stmt->execute([$symbol, $exch]);
$inst = $stmt->fetch();
if (!$inst) respond(['error' => 'Unknown instrument: ' . htmlspecialchars($symbol, ENT_QUOTES, 'UTF-8') . ' on ' . htmlspecialchars($exch, ENT_QUOTES, 'UTF-8')], 404);

// ── MARKET: fill immediately, exactly as before ────────────────────
if ($orderType === 'MARKET') {
    try {
        $jwt  = getAngelJwt();
        $resp = angelRequest('POST', '/rest/secure/angelbroking/market/v1/quote/', [
            'mode'           => 'LTP',
            'exchangeTokens' => [$exch => [$inst['token']]],
        ], $jwt);

        if (empty($resp['status']) || empty($resp['data']['fetched'][0]['ltp'])) {
            throw new Exception('No live price available right now.');
        }
        $price = (float) $resp['data']['fetched'][0]['ltp'];
    } catch (Exception $e) {
        respond(['error' => 'Could not fetch live price: ' . $e->getMessage()], 502);
    }

    try {
        $db->beginTransaction();
        $fillResult  = fillOrderAgainstAccount($db, $userId, $symbol, $exch, $side, $qty, $price);
        $newBalance  = $fillResult['newBalance'];
        $realizedPnl = $fillResult['realizedPnl'];

        $db->prepare(
            'INSERT INTO pd_orders (user_id, symbol, exch, side, qty, price, order_type, status, executed_price, executed_at, realized_pnl)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)'
        )->execute([$userId, $symbol, $exch, $side, $qty, $price, 'MARKET', 'EXECUTED', $price, $realizedPnl]);

        $db->commit();

        auditLog($userId, 'trade_executed', "$side $qty $symbol@$exch @ $price");

        respond([
            'message'     => "$side $qty $symbol @ ₹" . number_format($price, 2) . " executed.",
            'price'       => $price,
            'qty'         => $qty,
            'side'        => $side,
            'newBalance'  => $newBalance,
            'realizedPnl' => $realizedPnl,
        ]);
    } catch (Exception $e) {
        if ($db->inTransaction()) $db->rollBack();
        respond(['error' => $e->getMessage()], 400);
    }
}

// ── LIMIT / SL-M / SL-L: queue as PENDING, order-engine.php fills it later ──
// "price" column stores the user's intended reference price (limit
// for LIMIT/SL-L, trigger for SL-M) purely for display purposes —
// the real fill price is decided later and stored in executed_price.
$displayPrice = $limitPrice ?? $triggerPrice;

// ── Pending-order cap ────────────────────────────────────────────
// Without this, a user could queue unlimited PENDING orders — the
// engine loop scans ALL of them every 2s for every user, so an
// unbounded queue is a real load/DoS vector against the engine, not
// just a UX quirk. 25 open orders per user is generous for a paper
// trading app.
define('MAX_PENDING_ORDERS_PER_USER', 25);
$countStmt = $db->prepare("SELECT COUNT(*) AS c FROM pd_orders WHERE user_id = ? AND status IN ('PENDING','TRIGGERED')");
$countStmt->execute([$userId]);
if ((int) $countStmt->fetch()['c'] >= MAX_PENDING_ORDERS_PER_USER) {
    respond(['error' => 'You have too many open orders. Cancel some before placing more.'], 429);
}

// ── Upfront sanity check ─────────────────────────────────────────
// This does NOT reserve funds/shares (the real, authoritative check
// still happens atomically at fill time in fillOrderAgainstAccount,
// so a race between two orders can't cause a negative balance) — but
// it stops the obviously-bogus case of placing an order you have no
// realistic way to ever fund, and gives the user immediate feedback
// instead of a silent rejection minutes/hours later.
if ($side === 'BUY') {
    $refPrice = $limitPrice ?? $triggerPrice;
    $estCost  = $refPrice * $qty;
    $balStmt  = $db->prepare('SELECT balance FROM pd_users WHERE id = ?');
    $balStmt->execute([$userId]);
    $balance  = (float) $balStmt->fetch()['balance'];
    if ($estCost > $balance) {
        respond(['error' => sprintf(
            'Insufficient funds for this order. Estimated cost ₹%s, available ₹%s.',
            number_format($estCost, 2), number_format($balance, 2)
        )], 400);
    }
} else { // SELL
    $holdStmt = $db->prepare('SELECT qty FROM pd_holdings WHERE user_id = ? AND symbol = ? AND exch = ?');
    $holdStmt->execute([$userId, $symbol, $exch]);
    $held = (int) ($holdStmt->fetch()['qty'] ?? 0);
    if ($qty > $held) {
        respond(['error' => "You only hold $held shares of " . htmlspecialchars($symbol, ENT_QUOTES, 'UTF-8') . " — can't place a sell order for $qty."], 400);
    }
}

try {
    $stmt = $db->prepare(
        'INSERT INTO pd_orders (user_id, symbol, exch, side, qty, price, order_type, limit_price, trigger_price, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id'
    );
    $stmt->execute([$userId, $symbol, $exch, $side, $qty, $displayPrice, $orderType, $limitPrice, $triggerPrice, 'PENDING']);
    $orderId = $stmt->fetch()['id'];

    respond([
        'message'  => "$orderType $side order for $qty $symbol placed — waiting for price condition.",
        'orderId'  => $orderId,
        'status'   => 'PENDING',
    ]);
} catch (Exception $e) {
    respond(['error' => $e->getMessage()], 400);
}
