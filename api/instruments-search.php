<?php
// ── api/instruments-search.php ────────────────────────────────────
// GET ?q=<query> -> up to 15 matching instruments (symbol or name),
// used to power a real autocomplete search for "+ Add" on the
// watchlist, once pd_instruments has been populated by
// import-instruments.php.
require_once __DIR__ . '/config.php';
ensureTable();

requireAuth(); // must be logged in to search/add symbols

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

$q = trim($_GET['q'] ?? '');
if (strlen($q) < 1) respond(['instruments' => []]);

$stmt = getDB()->prepare(
    "SELECT token, symbol, name, exch
     FROM pd_instruments
     WHERE symbol ILIKE ? OR name ILIKE ?
     ORDER BY
       CASE WHEN symbol ILIKE ? THEN 0 ELSE 1 END, -- exact-ish symbol prefix first
       symbol ASC
     LIMIT 15"
);
$stmt->execute(["%$q%", "%$q%", "$q%"]);
respond(['instruments' => $stmt->fetchAll()]);
