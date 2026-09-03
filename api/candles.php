<?php
// ── api/candles.php ─────────────────────────────────────────────────
// GET ?symbol=RELIANCE&exch=NSE&interval=5m -> historical OHLC candles
// via Angel One's getCandleData, reshaped for TradingView's Lightweight
// Charts library ({time, open, high, low, close}).
require_once __DIR__ . '/angel-config.php';
ensureTable();

requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

$symbol = strtoupper(trim($_GET['symbol'] ?? ''));
$exch   = strtoupper(trim($_GET['exch'] ?? 'NSE'));
$tf     = $_GET['interval'] ?? '5m'; // frontend-friendly shorthand

if ($symbol === '') respond(['error' => 'Missing symbol'], 400);

// Map frontend shorthand -> Angel One's interval enum, and pick a
// lookback window that stays well under Angel One's per-interval
// history limits while still giving a useful number of candles.
$map = [
    '1m'  => ['ONE_MINUTE',    3],   // 3 days of 1-min candles
    '5m'  => ['FIVE_MINUTE',   10],  // 10 days of 5-min candles
    '15m' => ['FIFTEEN_MINUTE', 30],
    '1h'  => ['ONE_HOUR',      90],
    '1d'  => ['ONE_DAY',       365],
];
[$angelInterval, $lookbackDays] = $map[$tf] ?? $map['5m'];

$stmt = getDB()->prepare('SELECT token FROM pd_instruments WHERE symbol = ? AND exch = ?');
$stmt->execute([$symbol, $exch]);
$row = $stmt->fetch();
if (!$row) respond(['error' => 'Symbol not found in instrument master'], 404);

$toDate   = date('Y-m-d H:i');
$fromDate = date('Y-m-d H:i', time() - $lookbackDays * 86400);

try {
    $jwt = getAngelJwt();
    $resp = angelRequest('POST', '/rest/secure/angelbroking/historical/v1/getCandleData', [
        'exchange'    => $exch,
        'symboltoken' => $row['token'],
        'interval'    => $angelInterval,
        'fromdate'    => $fromDate,
        'todate'      => $toDate,
    ], $jwt);
} catch (Exception $e) {
    respond(['error' => 'Could not reach Angel One: ' . $e->getMessage()], 502);
}

if (empty($resp['status']) || !isset($resp['data'])) {
    respond(['error' => $resp['message'] ?? 'No candle data available'], 502);
}

// Angel One returns [ ["2024-01-02T09:15:00+05:30", open, high, low, close, volume], ... ]
// Lightweight Charts wants { time (unix seconds), open, high, low, close, volume }
$candles = array_map(function ($row) {
    return [
        'time'   => strtotime($row[0]),
        'open'   => (float) $row[1],
        'high'   => (float) $row[2],
        'low'    => (float) $row[3],
        'close'  => (float) $row[4],
        'volume' => (float) ($row[5] ?? 0),
    ];
}, $resp['data']);

respond(['candles' => $candles]);
