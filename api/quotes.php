<?php
// ── api/quotes.php ─────────────────────────────────────────────────
// POST { symbols: ["RELIANCE", "TCS", ...] } -> live LTP for each,
// via Angel One's batch quote endpoint (one call for up to 50
// symbols per exchange, far more efficient than one call per symbol).
require_once __DIR__ . '/angel-config.php';
ensureTable();

requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$body    = jsonBody();
// Expect [{symbol, exch}, ...] so we match the *exact* listing the
// user added — matching by symbol text alone risks pulling the wrong
// instrument if the same symbol exists on both NSE and BSE.
$requested = array_filter($body['symbols'] ?? []);
if (!$requested) respond(['quotes' => []]);

$pairs = [];
foreach ($requested as $item) {
    if (is_array($item)) {
        $sym  = strtoupper(trim($item['symbol'] ?? ''));
        $exch = strtoupper(trim($item['exch'] ?? 'NSE'));
    } else {
        // Backward-compat: plain symbol string, default to NSE
        $sym  = strtoupper(trim($item));
        $exch = 'NSE';
    }
    if ($sym !== '') $pairs[] = [$sym, $exch];
}
if (!$pairs) respond(['quotes' => []]);

// Look up tokens for the exact (symbol, exch) pairs requested
$conditions = implode(' OR ', array_fill(0, count($pairs), '(symbol = ? AND exch = ?)'));
$params = [];
foreach ($pairs as [$sym, $exch]) { $params[] = $sym; $params[] = $exch; }

$stmt = getDB()->prepare("SELECT token, symbol, exch FROM pd_instruments WHERE $conditions");
$stmt->execute($params);
$instruments = $stmt->fetchAll();

if (!$instruments) respond(['quotes' => []]);

try {
    $jwt = getAngelJwt();
} catch (Exception $e) {
    respond(['error' => 'Could not connect to Angel One: ' . $e->getMessage()], 502);
}

// Group tokens by exchange — Angel One's batch quote endpoint wants
// { "NSE": ["2885", "11536"], "BSE": [...] }, max 50 tokens per exchange per call.
// IMPORTANT: token numbers are only unique *within* an exchange — the
// same numeric token can mean a different stock on NSE vs BSE, so the
// symbol lookup below is scoped per-exchange to avoid cross-matching
// the wrong stock's price (this was the earlier bug).
$byExchange = [];
foreach ($instruments as $inst) {
    $byExchange[$inst['exch']][] = $inst['token'];
}

$quotes = [];
foreach ($byExchange as $exch => $tokens) {
    // Per-exchange token->symbol map, scoped so NSE/BSE token overlaps can't collide
    $tokenToSymbol = [];
    foreach ($instruments as $inst) {
        if ($inst['exch'] === $exch) $tokenToSymbol[$inst['token']] = $inst['symbol'];
    }

    foreach (array_chunk($tokens, 50) as $tokenChunk) {
        try {
            // mode 'OHLC' includes open/high/low/close alongside ltp,
            // which we need for day-change % (mode 'LTP' alone omits close).
            $resp = angelRequest('POST', '/rest/secure/angelbroking/market/v1/quote/', [
                'mode'           => 'OHLC',
                'exchangeTokens' => [$exch => $tokenChunk],
            ], $jwt);

            if (!empty($resp['status']) && !empty($resp['data']['fetched'])) {
                foreach ($resp['data']['fetched'] as $q) {
                    $symbol = $tokenToSymbol[$q['symbolToken']] ?? null;
                    if (!$symbol) continue;
                    $quotes[] = [
                        'symbol' => $symbol,
                        'ltp'    => (float) ($q['ltp'] ?? 0),
                        'close'  => (float) ($q['close'] ?? $q['ltp'] ?? 0),
                    ];
                }
            }
        } catch (Exception $e) {
            error_log('quotes.php batch failed for ' . $exch . ': ' . $e->getMessage());
            // Skip this batch, keep going with the rest
        }
    }
}

respond(['quotes' => $quotes]);
