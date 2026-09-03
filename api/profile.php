<?php
// ── api/profile.php ───────────────────────────────────────────────
// GET  -> returns full profile for the logged-in user
// PUT  -> updates name, dob, gender (email/password not editable here)
require_once __DIR__ . '/config.php';
ensureTable();

$userId = requireAuth();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = getDB()->prepare(
        'SELECT id, name, email, balance, dob, gender, created_at, auth_provider, last_login_at FROM pd_users WHERE id = ?'
    );
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user) respond(['error' => 'User not found.'], 404);
    respond(['user' => safeUser($user)]);
}

if ($_SERVER['REQUEST_METHOD'] === 'PUT' || $_SERVER['REQUEST_METHOD'] === 'PATCH') {
    $body   = jsonBody();
    $name   = trim($body['name'] ?? '');
    $dob    = trim($body['dob'] ?? '');       // expected format: YYYY-MM-DD
    $gender = trim($body['gender'] ?? '');    // free text: male / female / other / prefer_not_to_say

    if ($name !== '' && strlen($name) < 2)
        respond(['error' => 'Name must be at least 2 characters.'], 400);

    if ($dob !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dob))
        respond(['error' => 'Date of birth must be in YYYY-MM-DD format.'], 400);

    $allowedGenders = ['male', 'female', 'other', 'prefer_not_to_say', ''];
    if (!in_array($gender, $allowedGenders, true))
        respond(['error' => 'Invalid gender value.'], 400);

    $stmt = getDB()->prepare(
        'UPDATE pd_users
         SET name = COALESCE(NULLIF(?, \'\'), name),
             dob = NULLIF(?, \'\')::date,
             gender = NULLIF(?, \'\'),
             updated_at = NOW()
         WHERE id = ?
         RETURNING id, name, email, balance, dob, gender, created_at'
    );
    $stmt->execute([$name, $dob, $gender, $userId]);
    $user = $stmt->fetch();

    if (!$user) respond(['error' => 'Failed to update profile.'], 500);
    respond(['user' => safeUser($user), 'message' => 'Profile updated successfully']);
}

respond(['error' => 'Method not allowed'], 405);
