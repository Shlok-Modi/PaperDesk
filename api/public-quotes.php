<?php
// ── api/public-quotes.php ──────────────────────────────────────────
// POST { symbols: [{symbol, exch}, ...] } -> live LTP for the
// scrolling ticker tape on the homepage. Unlike quotes.php (which is
// per-user watchlist data and requires login), this is public market
// info visible to everyone, so no auth is required — it uses the
// server's own Angel One session, not a per-user one.
require_once __DIR__ . '/angel-config.php';
ensureTable();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$body      = jsonBody();
$requested = $body['symbols'] ?? [];
if (!$requested) respond(['quotes' => []]);

$pairs = [];
foreach ($requested as $item) {
    $sym  = strtoupper(trim($item['symbol'] ?? ''));
    $exch = strtoupper(trim($item['exch'] ?? 'NSE'));
    if ($sym !== '') $pairs[] = [$sym, $exch];
}
if (!$pairs) respond(['quotes' => []]);

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

$byExchange = [];
foreach ($instruments as $inst) {
    $byExchange[$inst['exch']][] = $inst['token'];
}

$quotes = [];
foreach ($byExchange as $exch => $tokens) {
    $tokenToSymbol = [];
    foreach ($instruments as $inst) {
        if ($inst['exch'] === $exch) $tokenToSymbol[$inst['token']] = $inst['symbol'];
    }

    foreach (array_chunk($tokens, 50) as $tokenChunk) {
        try {
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
            error_log('public-quotes.php batch failed for ' . $exch . ': ' . $e->getMessage());
        }
    }
}

respond(['quotes' => $quotes]);
