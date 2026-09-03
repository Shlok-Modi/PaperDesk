<?php
// ── cli/order-engine.php ─────────────────────────────────────────────
// THE ALWAYS-ON ORDER MATCHING ENGINE.
//
// This is a PHP CLI script — NOT a web page, NOT hit by a browser.
// Run it once (see below) and it loops forever, checking every 2
// seconds whether any PENDING/TRIGGERED order across ALL users
// should now fill, based on real live Angel One prices. It has
// nothing to do with whether anyone's browser is open — it's its own
// independent process, exactly like a real broker's matching engine.
//
// ── HOW TO RUN IT (Windows / XAMPP) ─────────────────────────────────
// Option 1 — quick manual test:
//   Open cmd, cd to your project's cli/ folder, run:
//     C:\xampp\php\php.exe order-engine.php
//   Leave that window open. Ctrl+C to stop.
//
// Option 2 — always running, survives reboots (recommended):
//   Windows Task Scheduler -> Create Task ->
//     Trigger: "At startup" (and/or "At log on")
//     Action:  Start a program
//       Program: C:\xampp\php\php.exe
//       Arguments: "C:\xampp\htdocs\paperdesk\cli\order-engine.php"
//     Settings: check "If the task fails, restart every 1 minute"
//               (protects against the script crashing on a transient
//               DB/API error taking your whole engine down silently)
//
// As long as this process is running on the machine (regardless of
// whether XAMPP's Apache is even serving anyone, or any browser tab
// is open), pending orders will fill the moment their condition is
// met — exactly the "real environment" behaviour you want.
require_once __DIR__ . '/../api/angel-config.php';
require_once __DIR__ . '/../api/order-lib.php';
require_once __DIR__ . '/../api/telegram-config.php';
ensureTable();

echo "[order-engine] Starting. Polling every 2s for pending orders + price alerts + Telegram link requests. Ctrl+C to stop.\n";

while (true) {
    try {
        runOneCheckCycle();
    } catch (Throwable $e) {
        // Never let one bad cycle kill the whole engine — log and
        // keep looping. A single Angel One hiccup shouldn't mean
        // pending orders stop being watched entirely.
        fwrite(STDERR, '[order-engine] Cycle error: ' . $e->getMessage() . "\n");
    }
    try {
        pollTelegramLinkRequests();
    } catch (Throwable $e) {
        fwrite(STDERR, '[order-engine] Telegram poll error: ' . $e->getMessage() . "\n");
    }
    sleep(2);
}

/**
 * Polls Telegram's getUpdates for new /start <code> messages (the
 * deep-link auto-linking flow — see telegram-link.php). Matches the
 * code back to a user, saves their chat_id, and clears the one-time
 * code so it can't be reused. Uses Telegram's own update_id offset
 * mechanism (stored in pd_telegram_state) so restarts never
 * re-process the same message twice.
 */
function pollTelegramLinkRequests(): void {
    if (TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') return; // not configured yet

    $db = getDB();
    $stateStmt = $db->query('SELECT last_update_id FROM pd_telegram_state WHERE id = 1');
    $state = $stateStmt->fetch();
    if (!$state) {
        $db->exec('INSERT INTO pd_telegram_state (id, last_update_id) VALUES (1, 0) ON CONFLICT (id) DO NOTHING');
        $lastUpdateId = 0;
    } else {
        $lastUpdateId = (int) $state['last_update_id'];
    }

    $url = 'https://api.telegram.org/bot' . TELEGRAM_BOT_TOKEN . '/getUpdates?offset=' . ($lastUpdateId + 1) . '&timeout=0';
    $ch  = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 8]);
    $raw = curl_exec($ch);
    curl_close($ch);
    if ($raw === false) return;

    $resp = json_decode($raw, true);
    if (empty($resp['ok']) || empty($resp['result'])) return;

    $maxUpdateId = $lastUpdateId;
    foreach ($resp['result'] as $update) {
        $maxUpdateId = max($maxUpdateId, (int) $update['update_id']);

        $text   = $update['message']['text'] ?? '';
        $chatId = $update['message']['chat']['id'] ?? null;
        if (!$chatId || !str_starts_with($text, '/start ')) continue;

        $code = trim(substr($text, 7));
        if ($code === '') continue;

        $userStmt = $db->prepare(
            "SELECT id, name FROM pd_users
             WHERE telegram_link_code = ? AND telegram_link_expires_at > NOW()"
        );
        $userStmt->execute([$code]);
        $user = $userStmt->fetch();

        if (!$user) {
            sendTelegramMessage((string) $chatId, "This link has expired or is invalid. Please generate a new link from PaperDesk's Profile page.");
            continue;
        }

        $db->prepare('UPDATE pd_users SET telegram_chat_id = ?, telegram_link_code = NULL, telegram_link_expires_at = NULL WHERE id = ?')
           ->execute([(string) $chatId, $user['id']]);

        sendTelegramMessage((string) $chatId,
            "✅ <b>PaperDesk linked!</b>\nHi {$user['name']}, you'll get price alerts here whenever your stocks hit your target prices."
        );
        echo "[order-engine] Telegram linked for user {$user['id']} (chat {$chatId})\n";
    }

    if ($maxUpdateId > $lastUpdateId) {
        $db->prepare('UPDATE pd_telegram_state SET last_update_id = ? WHERE id = 1')->execute([$maxUpdateId]);
    }
}

function runOneCheckCycle(): void {
    $db = getDB();

    $stmt = $db->query(
        "SELECT * FROM pd_orders WHERE status IN ('PENDING','TRIGGERED') ORDER BY created_at ASC"
    );
    $pending = $stmt->fetchAll();

    $alertStmt = $db->query("SELECT * FROM pd_price_alerts WHERE status = 'ACTIVE'");
    $activeAlerts = $alertStmt->fetchAll();

    if (!$pending && !$activeAlerts) return;

    // Fetch live LTP once per unique symbol/exch this cycle — shared
    // between pending orders AND price alerts, not once per item.
    $unique = [];
    foreach ($pending as $o) {
        $unique["{$o['exch']}:{$o['symbol']}"] = ['symbol' => $o['symbol'], 'exch' => $o['exch']];
    }
    foreach ($activeAlerts as $a) {
        $unique["{$a['exch']}:{$a['symbol']}"] = ['symbol' => $a['symbol'], 'exch' => $a['exch']];
    }

    $ltpBySymbol = fetchLtpBatch($db, array_values($unique));
    if (!$ltpBySymbol) return;

    foreach ($pending as $order) {
        $ltp = $ltpBySymbol[$order['symbol']] ?? null;
        if ($ltp === null) continue;

        $decision = evaluateOrderCondition($order, $ltp);

        if ($decision === 'TRIGGER') {
            // SL-L hitting its stop: becomes a live limit order.
            $db->prepare("UPDATE pd_orders SET status = 'TRIGGERED' WHERE id = ? AND status = 'PENDING'")
               ->execute([$order['id']]);
            echo "[order-engine] {$order['symbol']} SL-L order {$order['id']} triggered at LTP $ltp, now watching limit_price.\n";
            continue;
        }

        if ($decision === 'FILL') {
            $fillPrice = ($order['order_type'] === 'SL-M') ? $ltp : (float) ($order['limit_price'] ?? $ltp);
            fillPendingOrder($db, $order, $fillPrice);
        }
    }

    foreach ($activeAlerts as $alert) {
        $ltp = $ltpBySymbol[$alert['symbol']] ?? null;
        if ($ltp === null) continue;
        checkAndFireAlert($db, $alert, $ltp);
    }
}

/**
 * Fires an alert if the live price has crossed its trigger
 * condition, and atomically marks it TRIGGERED so it never fires
 * twice (same claim-first pattern as order filling).
 *
 * Sends via BOTH channels available: email always (every account has
 * one from signup — this guarantees the user is notified even if
 * they never linked Telegram), and Telegram additionally if linked.
 */
function checkAndFireAlert(PDO $db, array $alert, float $ltp): void {
    $hit = ($alert['direction'] === 'ABOVE' && $ltp >= (float) $alert['trigger_price'])
        || ($alert['direction'] === 'BELOW' && $ltp <= (float) $alert['trigger_price']);
    if (!$hit) return;

    $claim = $db->prepare("UPDATE pd_price_alerts SET status = 'TRIGGERED', triggered_at = NOW() WHERE id = ? AND status = 'ACTIVE'");
    $claim->execute([$alert['id']]);
    if ($claim->rowCount() === 0) return; // another cycle already claimed it

    $userStmt = $db->prepare('SELECT name, email, telegram_chat_id FROM pd_users WHERE id = ?');
    $userStmt->execute([$alert['user_id']]);
    $user = $userStmt->fetch();
    if (!$user) return;

    $arrow = $alert['direction'] === 'ABOVE' ? '📈' : '📉';
    $time  = (new DateTime('now', new DateTimeZone('Asia/Kolkata')))->format('d M Y, h:i:s A');
    $triggerFmt = number_format((float) $alert['trigger_price'], 2);
    $ltpFmt     = number_format($ltp, 2);

    // Email — always sent, since every account has one from signup.
    // Failure here (bad SMTP creds, etc.) is logged but never crashes
    // the engine — same "never let one channel kill the loop" rule
    // as everything else in here.
    try {
        $subject = "PaperDesk Alert: {$alert['symbol']} hit Rs. {$ltpFmt}";
        $html = <<<HTML
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="color:#111;">Price Alert Triggered</h2>
  <p>Hi {$user['name']},</p>
  <div style="background:#f3f3f3;border-radius:8px;padding:16px 20px;margin:20px 0;">
    <p style="margin:0 0 8px;font-size:20px;font-weight:700;">{$alert['symbol']} <span style="color:#888;font-size:14px;font-weight:400;">({$alert['exch']})</span></p>
    <p style="margin:4px 0;">Trigger: <b>{$alert['direction']}</b> ₹{$triggerFmt}</p>
    <p style="margin:4px 0;">Current LTP: <b>₹{$ltpFmt}</b></p>
    <p style="margin:4px 0;color:#666;">Time: {$time} IST</p>
  </div>
  <p style="color:#888;font-size:13px;">You set this alert on PaperDesk. It has now been marked as triggered.</p>
</div>
HTML;
        sendMail($user['email'], $user['name'], $subject, $html);
    } catch (\Throwable $e) {
        fwrite(STDERR, "[order-engine] Alert {$alert['id']} email failed: {$e->getMessage()}\n");
    }

    // Telegram — only if the user has linked their account.
    if (!empty($user['telegram_chat_id'])) {
        $msg = "{$arrow} <b>Price Alert Triggered</b>\n\n"
             . "<b>{$alert['symbol']}</b> ({$alert['exch']})\n"
             . "Trigger price: ₹{$triggerFmt} ({$alert['direction']})\n"
             . "Current LTP: ₹{$ltpFmt}\n"
             . "Time: {$time} IST";
        sendTelegramMessage($user['telegram_chat_id'], $msg);
    }

    echo "[order-engine] Alert {$alert['id']} fired for {$alert['symbol']} @ {$ltp} (email: {$user['email']}"
       . (!empty($user['telegram_chat_id']) ? ", telegram: {$user['telegram_chat_id']}" : ", no telegram") . ")\n";
}

/**
 * Fetches LTP for a batch of symbols via Angel One's quote endpoint,
 * grouped by exchange (same batching pattern as quotes.php).
 * Returns [ 'SYMBOL' => ltp, ... ].
 */
function fetchLtpBatch(PDO $db, array $symbols): array {
    if (!$symbols) return [];

    $byExch = [];
    foreach ($symbols as $s) {
        $byExch[$s['exch']][] = $s['symbol'];
    }

    // Resolve tokens
    $tokensByExchange = [];
    $symbolByToken = [];
    foreach ($byExch as $exch => $syms) {
        $placeholders = implode(',', array_fill(0, count($syms), '?'));
        $stmt = $db->prepare("SELECT token, symbol FROM pd_instruments WHERE exch = ? AND symbol IN ($placeholders)");
        $stmt->execute(array_merge([$exch], $syms));
        foreach ($stmt->fetchAll() as $row) {
            $tokensByExchange[$exch][] = $row['token'];
            $symbolByToken[$row['token']] = $row['symbol'];
        }
    }
    if (!$tokensByExchange) return [];

    try {
        $jwt  = getAngelJwt();
        $resp = angelRequest('POST', '/rest/secure/angelbroking/market/v1/quote/', [
            'mode'           => 'LTP',
            'exchangeTokens' => $tokensByExchange,
        ], $jwt);
    } catch (Exception $e) {
        fwrite(STDERR, '[order-engine] LTP fetch failed: ' . $e->getMessage() . "\n");
        return [];
    }

    if (empty($resp['status']) || empty($resp['data']['fetched'])) return [];

    $out = [];
    foreach ($resp['data']['fetched'] as $q) {
        $sym = $symbolByToken[$q['symbolToken']] ?? null;
        if ($sym && isset($q['ltp'])) $out[$sym] = (float) $q['ltp'];
    }
    return $out;
}

/**
 * Actually fills a pending order: runs it through the exact same
 * account logic as an instant MARKET order, then marks the order row
 * EXECUTED. Uses an atomic claim (status check inside the UPDATE) so
 * two engine cycles can never double-fill the same order.
 */
function fillPendingOrder(PDO $db, array $order, float $fillPrice): void {
    $db->beginTransaction();
    try {
        // Atomically claim this order first — if another process
        // already moved it out of PENDING/TRIGGERED, this affects 0
        // rows and we bail out without touching balance/holdings.
        $claim = $db->prepare(
            "UPDATE pd_orders SET status = 'FILLING' WHERE id = ? AND status IN ('PENDING','TRIGGERED')"
        );
        $claim->execute([$order['id']]);
        if ($claim->rowCount() === 0) {
            $db->rollBack();
            return;
        }

        $fillResult  = fillOrderAgainstAccount(
            $db, $order['user_id'], $order['symbol'], $order['exch'], $order['side'], (int) $order['qty'], $fillPrice
        );
        $newBalance  = $fillResult['newBalance'];
        $realizedPnl = $fillResult['realizedPnl'];

        $db->prepare(
            "UPDATE pd_orders SET status = 'EXECUTED', executed_price = ?, executed_at = NOW(), realized_pnl = ? WHERE id = ?"
        )->execute([$fillPrice, $realizedPnl, $order['id']]);

        $db->commit();
        echo "[order-engine] FILLED {$order['order_type']} {$order['side']} {$order['qty']} {$order['symbol']} @ {$fillPrice} (order {$order['id']}), new balance {$newBalance}\n";
    } catch (Exception $e) {
        $db->rollBack();
        // Insufficient funds/holdings by the time it triggered (e.g.
        // user's balance changed via another trade in between) —
        // reject rather than leave it silently stuck.
        $db->prepare("UPDATE pd_orders SET status = 'REJECTED' WHERE id = ?")->execute([$order['id']]);
        fwrite(STDERR, "[order-engine] Order {$order['id']} rejected: {$e->getMessage()}\n");
    }
}
