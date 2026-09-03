<?php
// ── api/order-lib.php ────────────────────────────────────────────────
// Shared logic for actually filling an order against a user's balance
// and holdings. Used by trade.php (instant MARKET fills) AND by
// order-engine.php (background LIMIT/SL-M/SL-L fills) so both paths
// go through the exact same, single, well-tested code — no risk of
// the two diverging and one having a bug the other doesn't.
//
// IMPORTANT: caller must already be inside a transaction with the
// user row locked (SELECT ... FOR UPDATE) before calling this.
//
// Throws Exception on insufficient funds / insufficient holdings.
// Returns the user's new balance after the fill.
/**
 * Returns ['newBalance' => float, 'realizedPnl' => float|null].
 * realizedPnl is null for BUY fills (no P&L is "realized" on a buy —
 * only on a sell, against whatever the average cost basis was).
 */
function fillOrderAgainstAccount(PDO $db, string $userId, string $symbol, string $exch, string $side, int $qty, float $price): array {
    $userStmt = $db->prepare('SELECT balance FROM pd_users WHERE id = ? FOR UPDATE');
    $userStmt->execute([$userId]);
    $user = $userStmt->fetch();
    if (!$user) throw new Exception('User not found.');
    $balance = (float) $user['balance'];

    // Make sure any position left open from a previous day has
    // already rolled into plain portfolio qty before we compute
    // anything below — otherwise a same-day sell could incorrectly
    // decrement today_qty for shares that were actually bought
    // yesterday (or earlier).
    rolloverHoldings($db, $userId);

    $holdingStmt = $db->prepare(
        'SELECT qty, avg_price, today_qty FROM pd_holdings WHERE user_id = ? AND symbol = ? AND exch = ? FOR UPDATE'
    );
    $holdingStmt->execute([$userId, $symbol, $exch]);
    $holding = $holdingStmt->fetch();

    $realizedPnl = null;

    if ($side === 'BUY') {
        $cost = $price * $qty;
        if ($cost > $balance) {
            throw new Exception(sprintf(
                'Insufficient funds. Need ₹%s, available ₹%s.',
                number_format($cost, 2), number_format($balance, 2)
            ));
        }

        $newBalance = $balance - $cost;
        $db->prepare('UPDATE pd_users SET balance = ? WHERE id = ?')->execute([$newBalance, $userId]);

        if ($holding) {
            $newQty      = $holding['qty'] + $qty;
            $newAvgPrice = (($holding['qty'] * $holding['avg_price']) + ($qty * $price)) / $newQty;
            $newTodayQty = $holding['today_qty'] + $qty;
            $db->prepare(
                'UPDATE pd_holdings SET qty = ?, avg_price = ?, today_qty = ?, today_date = CURRENT_DATE, updated_at = NOW()
                 WHERE user_id = ? AND symbol = ? AND exch = ?'
            )->execute([$newQty, $newAvgPrice, $newTodayQty, $userId, $symbol, $exch]);
        } else {
            $db->prepare(
                'INSERT INTO pd_holdings (user_id, symbol, exch, qty, avg_price, today_qty, today_date)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE)'
            )->execute([$userId, $symbol, $exch, $qty, $price, $qty]);
        }
    } else { // SELL
        $heldQty = $holding['qty'] ?? 0;
        if ($qty > $heldQty) {
            throw new Exception("You only hold $heldQty shares of " . htmlspecialchars($symbol, ENT_QUOTES, 'UTF-8') . " — can't sell $qty.");
        }

        // Realized P&L for this sale: what you sold at, minus what
        // you originally paid (avg_price), for exactly this quantity.
        // This is captured here and nowhere else, because avg_price
        // is about to change/disappear once the holding is updated.
        $realizedPnl = ($price - $holding['avg_price']) * $qty;

        $proceeds   = $price * $qty;
        $newBalance = $balance + $proceeds;
        $db->prepare('UPDATE pd_users SET balance = ? WHERE id = ?')->execute([$newBalance, $userId]);

        $remainingQty      = $heldQty - $qty;
        // A sell eats into today's (intraday) position first, same as
        // a real square-off — only spills over into the carried-
        // forward portfolio qty once today's own qty is exhausted.
        $remainingTodayQty = max(0, $holding['today_qty'] - $qty);
        if ($remainingQty > 0) {
            $db->prepare(
                'UPDATE pd_holdings SET qty = ?, today_qty = ?, updated_at = NOW()
                 WHERE user_id = ? AND symbol = ? AND exch = ?'
            )->execute([$remainingQty, $remainingTodayQty, $userId, $symbol, $exch]);
        } else {
            $db->prepare('DELETE FROM pd_holdings WHERE user_id = ? AND symbol = ? AND exch = ?')
               ->execute([$userId, $symbol, $exch]);
        }
    }

    return ['newBalance' => $newBalance, 'realizedPnl' => $realizedPnl];
}

/**
 * Decides whether a pending order's condition is met given the
 * current LTP. Returns one of:
 *   'FILL'    -> execute now, at $ltp for MARKET-style fills (SL-M),
 *                or at the order's own limit_price for LIMIT/SL-L.
 *   'TRIGGER' -> SL-L only: stop price hit, order becomes a live
 *                LIMIT order from now on (status -> TRIGGERED).
 *   'WAIT'    -> condition not met yet, leave as-is.
 */
function evaluateOrderCondition(array $order, float $ltp): string {
    $side = $order['side'];
    $type = $order['order_type'];

    if ($type === 'LIMIT') {
        $limit = (float) $order['limit_price'];
        if ($side === 'BUY'  && $ltp <= $limit) return 'FILL';
        if ($side === 'SELL' && $ltp >= $limit) return 'FILL';
        return 'WAIT';
    }

    if ($type === 'SL-M') {
        $trigger = (float) $order['trigger_price'];
        // SL-M SELL: protects a long position — fires when price falls to/through trigger.
        // SL-M BUY: protects a short / catches a breakout — fires when price rises to/through trigger.
        if ($side === 'SELL' && $ltp <= $trigger) return 'FILL';
        if ($side === 'BUY'  && $ltp >= $trigger) return 'FILL';
        return 'WAIT';
    }

    if ($type === 'SL-L') {
        if ($order['status'] === 'PENDING') {
            $trigger = (float) $order['trigger_price'];
            $hit = ($side === 'SELL' && $ltp <= $trigger) || ($side === 'BUY' && $ltp >= $trigger);
            return $hit ? 'TRIGGER' : 'WAIT';
        }
        // Already TRIGGERED — now behaves exactly like a LIMIT order.
        $limit = (float) $order['limit_price'];
        if ($side === 'BUY'  && $ltp <= $limit) return 'FILL';
        if ($side === 'SELL' && $ltp >= $limit) return 'FILL';
        return 'WAIT';
    }

    return 'WAIT';
}
