<?php
// ── api/me.php ────────────────────────────────────────────────────
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    respond(['error' => 'Method not allowed'], 405);
}

$userId = requireAuth();
$stmt   = getDB()->prepare(
    'SELECT id, name, email, balance, dob, gender, created_at FROM pd_users WHERE id = ?'
);
$stmt->execute([$userId]);
$user = $stmt->fetch();

if (!$user) respond(['error' => 'User not found.'], 404);
respond(['user' => safeUser($user)]);
