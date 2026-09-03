<?php
// ── api/import-clean-instruments.php ────────────────────────────────
// One-off import: replaces pd_instruments with the cleaned,
// active-only CSV (cross-referenced against NSE/BSE's own official
// active lists — see pd_instruments_active_only.csv sitting next to
// this file). TRUNCATEs first, so the noisy 22k-row set is fully
// replaced by the ~7k verified-active rows.
//
// 1. Put pd_instruments_active_only.csv in this same api/ folder.
// 2. Visit this file directly in your browser once.
// 3. Delete both files afterward if you don't want them reachable.
require_once __DIR__ . '/config.php';
ensureTable();
requireAdminKey();

$csvPath = __DIR__ . '/pd_instruments_active_only.csv';
if (!file_exists($csvPath)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'pd_instruments_active_only.csv not found next to this script.']);
    exit;
}

$fh = fopen($csvPath, 'r');
$header = fgetcsv($fh); // skip header row: token,symbol,name,exch,instrument_type,lot_size,tick_size,updated_at

$rows = [];
while (($row = fgetcsv($fh)) !== false) {
    $rows[] = $row;
}
fclose($fh);

$db = getDB();
$db->beginTransaction();
$db->exec('TRUNCATE pd_instruments');

$imported = 0;
foreach (array_chunk($rows, 500) as $batch) {
    $placeholders = [];
    $values = [];
    foreach ($batch as $row) {
        // token, symbol, name, exch, instrument_type, lot_size, tick_size, updated_at
        $placeholders[] = '(?, ?, ?, ?, ?, ?, ?, NOW())';
        array_push($values, $row[0], $row[1], $row[2], $row[3], $row[4], (int) $row[5], (float) $row[6]);
    }
    $sql = 'INSERT INTO pd_instruments (token, symbol, name, exch, instrument_type, lot_size, tick_size, updated_at)
            VALUES ' . implode(',', $placeholders);
    $db->prepare($sql)->execute($values);
    $imported += count($batch);
}

$db->commit();
echo json_encode(['ok' => true, 'imported' => $imported, 'message' => "Replaced pd_instruments with $imported verified-active rows."]);
