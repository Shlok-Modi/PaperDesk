<?php
// ── api/verify-signup-otp.php ───────────────────────────────────────
// POST { email, otp } -> confirms the signup OTP sent by signup.php,
// marks the account email_verified, and logs the user straight in
// (issues a JWT) since they've now proven both the password AND
// email ownership.
require_once __DIR__ . '/config.php';
ensureTable();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$body  = jsonBody();
$email = strtolower(trim($body['email'] ?? ''));
$otp   = trim($body['otp'] ?? '');

if (!$email || !$otp)
    respond(['error' => 'Missing email or code.'], 400);

$db   = getDB();
$stmt = $db->prepare('SELECT * FROM pd_users WHERE email = ?');
$stmt->execute([$email]);
$user = $stmt->fetch();

if (!$user) respond(['error' => 'Invalid or expired code.'], 400);

if ($user['email_verified']) {
    // Already verified (e.g. double submit, or link opened twice) —
    // just log them in rather than erroring.
    auditLog($user['id'], 'signup_verify_already_done', $email);
    respond([
        'user'    => safeUser($user),
        'token'   => generateJWT($user['id']),
        'message' => 'Email already verified.',
    ]);
}

$rstmt = $db->prepare(
    "SELECT * FROM pd_otp_resets
     WHERE user_id = ? AND purpose = 'signup_verify' AND used = FALSE AND otp_expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1"
);
$rstmt->execute([$user['id']]);
$row = $rstmt->fetch();

if (!$row) respond(['error' => 'Invalid or expired code.'], 400);

if ($row['attempts'] >= 5) {
    respond(['error' => 'Too many attempts. Please request a new code.'], 429);
}

$otpHash = hash('sha256', $otp);
if (!hash_equals($row['otp_hash'], $otpHash)) {
    $db->prepare('UPDATE pd_otp_resets SET attempts = attempts + 1 WHERE id = ?')
       ->execute([$row['id']]);
    respond(['error' => 'Incorrect code. Please try again.'], 400);
}

$db->prepare('UPDATE pd_otp_resets SET used = TRUE WHERE id = ?')->execute([$row['id']]);
$db->prepare('UPDATE pd_users SET email_verified = TRUE, updated_at = NOW() WHERE id = ?')->execute([$user['id']]);

auditLog($user['id'], 'signup_verified', $email);

respond([
    'user'    => safeUser($user),
    'token'   => generateJWT($user['id']),
    'message' => 'Email verified. Welcome to PaperDesk!',
]);
