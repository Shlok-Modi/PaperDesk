<?php
// ── api/reset-password.php ────────────────────────────────────────
// POST { email, reset_token, password } -> validates the reset_token
// issued by verify-otp.php (proves the user completed the OTP step)
// and updates the user's password hash.
require_once __DIR__ . '/config.php';
ensureTable();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$body       = jsonBody();
$email      = strtolower(trim($body['email'] ?? ''));
$resetToken = trim($body['reset_token'] ?? '');
$password   = $body['password'] ?? '';

if (!$email || !$resetToken || !$password)
    respond(['error' => 'Missing email, reset token, or password.'], 400);
if ($pwError = validatePasswordPolicy($password))
    respond(['error' => $pwError], 400);

$db   = getDB();
$stmt = $db->prepare('SELECT id FROM pd_users WHERE email = ?');
$stmt->execute([$email]);
$user = $stmt->fetch();
if (!$user) respond(['error' => 'Invalid or expired reset session.'], 400);

$resetTokenHash = hash('sha256', $resetToken);
$rstmt = $db->prepare(
    'SELECT id FROM pd_otp_resets
     WHERE user_id = ? AND reset_token_hash = ? AND verified = TRUE
       AND used = FALSE AND reset_expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1'
);
$rstmt->execute([$user['id'], $resetTokenHash]);
$resetRow = $rstmt->fetch();

if (!$resetRow) respond(['error' => 'Invalid or expired reset session.'], 400);

$hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
$db->prepare('UPDATE pd_users SET password_hash = ?, updated_at = NOW() WHERE id = ?')
   ->execute([$hash, $user['id']]);

// Mark this OTP/reset row used so it can't be replayed
$db->prepare('UPDATE pd_otp_resets SET used = TRUE WHERE id = ?')
   ->execute([$resetRow['id']]);

auditLog($user['id'], 'password_reset', $email);

respond(['message' => 'Password reset successfully. You can now sign in.']);
