<?php
// ── api/indices.php ────────────────────────────────────────────────
// GET -> live NIFTY 50, BANK NIFTY, SENSEX values + whether the
// market is currently open. Public — no auth required.
//
// Indices aren't regular equities, so they don't come from
// pd_instruments (which only holds NSE/BSE stocks) — they use fixed,
// well-known Angel One tokens instead:
//   NIFTY 50    -> NSE, token 99926000
//   BANK NIFTY  -> NSE, token 99926009
//   SENSEX      -> BSE, token 99919000
require_once __DIR__ . '/angel-config.php';
ensureTable();

header('Content-Type: application/json');

const INDEX_TOKENS = [
    'NIFTY 50'   => ['exch' => 'NSE', 'token' => '99926000'],
    'BANK NIFTY' => ['exch' => 'NSE', 'token' => '99926009'],
    'SENSEX'     => ['exch' => 'BSE', 'token' => '99919000'],
    'INDIA VIX'  => ['exch' => 'NSE', 'token' => '99926037'],
];

// isMarketOpen() now lives in config.php (shared with trade.php, which
// uses it to block order placement while the market is closed).

$marketOpen = isMarketOpen();

try {
    $jwt = getAngelJwt();
    $byExchange = [];
    foreach (INDEX_TOKENS as $name => $info) {
        $byExchange[$info['exch']][] = $info['token'];
    }

    $tokenToName = [];
    foreach (INDEX_TOKENS as $name => $info) {
        $tokenToName[$info['exch'] . ':' . $info['token']] = $name;
    }

    $results = [];
    foreach ($byExchange as $exch => $tokens) {
        $resp = angelRequest('POST', '/rest/secure/angelbroking/market/v1/quote/', [
            'mode'           => 'OHLC',
            'exchangeTokens' => [$exch => $tokens],
        ], $jwt);

        if (!empty($resp['status']) && !empty($resp['data']['fetched'])) {
            foreach ($resp['data']['fetched'] as $q) {
                $name = $tokenToName[$exch . ':' . $q['symbolToken']] ?? null;
                if (!$name) continue;
                $results[$name] = [
                    'name'  => $name,
                    'value' => (float) ($q['ltp'] ?? 0),
                    'close' => (float) ($q['close'] ?? $q['ltp'] ?? 0),
                ];
            }
        }
    }

    respond(['indices' => array_values($results), 'marketOpen' => $marketOpen]);
} catch (Exception $e) {
    // Even if Angel One is unreachable, still tell the frontend the
    // correct open/closed status so the page isn't misleading.
    respond(['indices' => [], 'marketOpen' => $marketOpen, 'error' => $e->getMessage()], 200);
}
