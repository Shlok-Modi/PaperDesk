<?php
// ── api/verify-otp.php ──────────────────────────────────────────────
// POST { email, otp } -> checks the OTP, and if valid, issues a
// short-lived one-time reset token (returned to the client so it can
// be used in the next step, reset-password.php). The OTP itself is
// consumed here and cannot be reused.
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
$stmt = $db->prepare('SELECT id FROM pd_users WHERE email = ?');
$stmt->execute([$email]);
$user = $stmt->fetch();

if (!$user) respond(['error' => 'Invalid or expired code.'], 400);

// Most recent, still-usable OTP row for this user
$rstmt = $db->prepare(
    "SELECT * FROM pd_otp_resets
     WHERE user_id = ? AND used = FALSE AND otp_expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1"
);
$rstmt->execute([$user['id']]);
$row = $rstmt->fetch();

if (!$row) respond(['error' => 'Invalid or expired code.'], 400);

// Cap attempts to slow down brute-forcing a 6-digit code
if ($row['attempts'] >= 5) {
    respond(['error' => 'Too many attempts. Please request a new code.'], 429);
}

$otpHash = hash('sha256', $otp);
if (!hash_equals($row['otp_hash'], $otpHash)) {
    $db->prepare('UPDATE pd_otp_resets SET attempts = attempts + 1 WHERE id = ?')
       ->execute([$row['id']]);
    respond(['error' => 'Incorrect code. Please try again.'], 400);
}

// OTP correct — issue a reset token, valid for 10 minutes, and mark
// this row verified so reset-password.php can check it.
$resetToken     = bin2hex(random_bytes(32));
$resetTokenHash = hash('sha256', $resetToken);
$resetExpiresAt = date('Y-m-d H:i:s', time() + 600);

$db->prepare(
    'UPDATE pd_otp_resets
     SET verified = TRUE, reset_token_hash = ?, reset_expires_at = ?
     WHERE id = ?'
)->execute([$resetTokenHash, $resetExpiresAt, $row['id']]);

respond([
    'message'     => 'Code verified.',
    'reset_token' => $resetToken,
]);
