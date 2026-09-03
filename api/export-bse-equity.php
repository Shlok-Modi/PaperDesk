<?php
// ── api/export-bse-equity.php ───────────────────────────────────────
// Exports every BSE equity-segment instrument already sitting in
// pd_instruments (populated by import-instruments.php from Angel
// One's OpenAPIScripMaster.json) as a downloadable CSV — opens
// directly in Excel, no extra PHP libraries needed.
//
// Visit directly in your browser once logged in doesn't apply here —
// this is a one-off admin/data export, so it's intentionally NOT
// behind requireAuth(). If you don't want it publicly reachable,
// delete this file after downloading, or add requireAuth() back in.
require_once __DIR__ . '/config.php';
ensureTable();
requireAdminKey();

$stmt = getDB()->prepare(
    "SELECT token, symbol, name, exch, instrument_type, lot_size, tick_size
     FROM pd_instruments
     WHERE exch = 'BSE'
       AND (instrument_type IS NULL OR instrument_type IN ('', 'EQ'))
     ORDER BY symbol ASC"
);
$stmt->execute();
$rows = $stmt->fetchAll();

header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="bse_equity_list.csv"');

$out = fopen('php://output', 'w');
fputcsv($out, ['Token', 'Symbol', 'Company Name', 'Exchange', 'Instrument Type', 'Lot Size', 'Tick Size']);
foreach ($rows as $r) {
    fputcsv($out, [$r['token'], $r['symbol'], $r['name'], $r['exch'], $r['instrument_type'], $r['lot_size'], $r['tick_size']]);
}
fclose($out);
