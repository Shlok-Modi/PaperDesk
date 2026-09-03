<?php
// ── api/dbtest.php ──────────────────────────────────────────────────
// Quick DB connectivity check. Visit directly in your browser:
//   http://localhost/paperdesk2/api/dbtest.php?key=YOUR_PD_ADMIN_KEY
// Gated by PD_ADMIN_KEY (set it in api/.env) so this isn't a public
// endpoint that leaks connection details to anyone who finds the URL.
require_once __DIR__ . '/config.php';
requireAdminKey();

header('Content-Type: application/json');

$host = env('PD_DB_HOST', 'YOUR_NEON_HOST_HERE');
$user = env('PD_DB_USER', 'neondb_owner');
$pass = env('PD_DB_PASSWORD', 'YOUR_DB_PASSWORD_HERE');
$db   = 'neondb';
$ep   = env('PD_DB_ENDPOINT_ID', 'YOUR_ENDPOINT_ID_HERE');

$methods = [
  'A' => "pgsql:host=$host;port=5432;dbname=$db;sslmode=require;options=endpoint%3D$ep",
  'B' => "pgsql:host=$host;port=5432;dbname=$db;sslmode=require;options=endpoint=$ep",
  'C' => "pgsql:host=$host;port=5432;dbname=$db;sslmode=require;options=--endpoint=$ep",
];

$opts = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 8];
$errs = [];

foreach ($methods as $k => $dsn) {
  try {
    $pdo = new PDO($dsn, $user, $pass, $opts);
    // Don't echo the DSN back — it contains host/endpoint details
    // that don't need to be exposed even to an authenticated caller.
    echo json_encode(['method' => $k, 'status' => 'CONNECTED']);
    exit;
  } catch (Exception $e) {
    $errs[$k] = $e->getMessage();
  }
}
echo json_encode(['all_failed' => $errs]);
