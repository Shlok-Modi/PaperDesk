<?php
// ── api/login.php ─────────────────────────────────────────────────
require_once __DIR__ . '/config.php';
ensureTable();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$body     = jsonBody();
$email    = strtolower(trim($body['email']    ?? ''));
$password = $body['password'] ?? '';

if (!$email || !$password)
    respond(['error' => 'Email and password are required.'], 400);

// ── RATE LIMITING ────────────────────────────────────────────────
// Blocks further attempts for this email after too many recent
// failures, regardless of whether the account exists — this avoids
// leaking account existence via different lockout behaviour.
if (isLoginLocked($email)) {
    auditLog(null, 'login_locked', $email);
    respond(['error' => 'Too many failed attempts. Please try again in a few minutes.'], 429);
}

$db   = getDB();
$stmt = $db->prepare('SELECT * FROM pd_users WHERE email = ?');
$stmt->execute([$email]);
$user = $stmt->fetch();

// Google-only accounts have password_hash = NULL — password_verify()
// requires a string, so treat a missing hash as "wrong password"
// rather than passing null through.
if (!$user || !$user['password_hash'] || !password_verify($password, $user['password_hash'])) {
    recordLoginAttempt($email, false);
    auditLog($user['id'] ?? null, 'login_failed', $email);
    respond(['error' => 'Invalid email or password.'], 401);
}

if (!$user['email_verified']) {
    // Right credentials, but they never finished the signup OTP step.
    // Distinct error code (not just a string) so the frontend can
    // redirect straight to the verification screen instead of just
    // showing a dead-end error.
    auditLog($user['id'], 'login_blocked_unverified', $email);
    respond(['error' => 'Please verify your email before signing in.', 'code' => 'EMAIL_NOT_VERIFIED', 'email' => $email], 403);
}

recordLoginAttempt($email, true);
auditLog($user['id'], 'login_success', $email);
$db->prepare('UPDATE pd_users SET last_login_at = NOW() WHERE id = ?')->execute([$user['id']]);
$user['last_login_at'] = date('c'); // reflect the update we just made without a second SELECT

respond([
    'user'    => safeUser($user),
    'token'   => generateJWT($user['id']),
    'message' => 'Login successful',
]);
