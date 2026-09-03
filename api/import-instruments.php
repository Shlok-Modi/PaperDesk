<?php
// ── api/import-instruments.php ────────────────────────────────────
// Downloads Angel One's full instrument master (all NSE/BSE symbols,
// ~90,000+ rows including F&O/currency — we filter down to plain
// equities) and loads them into pd_instruments.
//
// Run this by visiting it directly in your browser:
//   http://localhost/paperdesk2/api/import-instruments.php
//
// Angel One updates this file daily, so re-run it periodically
// (e.g. once a day via a cron job hitting this URL, or manually).
// No login/API key needed for this specific file — it's public.
require_once __DIR__ . '/config.php';
ensureTable();
requireAdminKey();

set_time_limit(0); // this file is large; don't let PHP kill it
ini_set('max_execution_time', '0');

header('Content-Type: application/json');

const SCRIP_MASTER_URL = 'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json';
const BATCH_SIZE = 500; // rows per multi-row INSERT — cuts round trips to the DB drastically

try {
    $ch = curl_init(SCRIP_MASTER_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 120,
        CURLOPT_FOLLOWLOCATION => true,
    ]);
    $raw = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($raw === false || $raw === '') {
        throw new Exception('Failed to download scrip master: ' . $err);
    }

    $rows = json_decode($raw, true);
    if (!is_array($rows)) {
        throw new Exception('Scrip master response was not valid JSON.');
    }

    // Filter down to NSE/BSE equities first, so we only ever build
    // batches out of rows we actually want to keep.
    $filtered = [];
    foreach ($rows as $row) {
        $exch = $row['exch_seg'] ?? '';
        if (!in_array($exch, ['NSE', 'BSE'], true)) continue;

        $symbol = $row['symbol'] ?? '';
        $cleanSymbol = preg_replace('/-EQ$/', '', $symbol);
        if ($cleanSymbol === '') continue;

        $filtered[] = [
            $row['token']           ?? '',
            $cleanSymbol,
            $row['name']            ?? $cleanSymbol,
            $exch,
            $row['instrumenttype']  ?? 'EQ',
            (int) ($row['lotsize']  ?? 1),
            (float) ($row['tick_size'] ?? 0.05) / 100,
        ];
    }

    $db = getDB();
    $db->beginTransaction();
    $db->exec('TRUNCATE pd_instruments');

    $imported = 0;
    foreach (array_chunk($filtered, BATCH_SIZE) as $batch) {
        $placeholders = [];
        $values = [];
        foreach ($batch as $row) {
            $placeholders[] = '(?, ?, ?, ?, ?, ?, ?, NOW())';
            array_push($values, ...$row);
        }
        $sql = 'INSERT INTO pd_instruments (token, symbol, name, exch, instrument_type, lot_size, tick_size, updated_at)
                VALUES ' . implode(',', $placeholders) . '
                ON CONFLICT (token) DO UPDATE SET
                  symbol = EXCLUDED.symbol, name = EXCLUDED.name, exch = EXCLUDED.exch,
                  instrument_type = EXCLUDED.instrument_type, lot_size = EXCLUDED.lot_size,
                  tick_size = EXCLUDED.tick_size, updated_at = NOW()';
        $db->prepare($sql)->execute($values);
        $imported += count($batch);
    }

    $db->commit();
    echo json_encode([
        'ok' => true,
        'imported' => $imported,
        'total_rows_seen' => count($rows),
        'message' => "Imported $imported NSE/BSE equity instruments.",
    ]);
} catch (Exception $e) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
