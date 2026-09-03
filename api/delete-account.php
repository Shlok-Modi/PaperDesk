<?php
// ── api/delete-account.php ──────────────────────────────────────────
// POST -> permanently deletes the logged-in user's account.
//
// This is destructive and irreversible: pd_holdings, pd_orders,
// pd_watchlists, and pd_alerts all reference pd_users with
// ON DELETE CASCADE, so a single DELETE on pd_users cleanly removes
// every trace of the account in one transaction — no orphaned rows.
//
// Confirmation depends on how the account was created:
//   - password accounts -> must re-enter their current password
//   - Google-only accounts (no password_hash) -> must type "DELETE",
//     since there's no password to verify against
require_once __DIR__ . '/config.php';
ensureTable();

$userId = requireAuth();

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'DELETE') {
    respond(['error' => 'Method not allowed'], 405);
}

$body        = jsonBody();
$password    = (string) ($body['password'] ?? '');
$confirmText = trim((string) ($body['confirm'] ?? ''));

$stmt = getDB()->prepare('SELECT password_hash FROM pd_users WHERE id = ?');
$stmt->execute([$userId]);
$user = $stmt->fetch();
if (!$user) respond(['error' => 'User not found.'], 404);

if ($user['password_hash']) {
    if ($password === '' || !password_verify($password, $user['password_hash'])) {
        respond(['error' => 'Incorrect password.'], 401);
    }
} else {
    if (strtoupper($confirmText) !== 'DELETE') {
        respond(['error' => 'Please type DELETE to confirm.'], 400);
    }
}

getDB()->prepare('DELETE FROM pd_users WHERE id = ?')->execute([$userId]);

respond(['message' => 'Account deleted.']);
