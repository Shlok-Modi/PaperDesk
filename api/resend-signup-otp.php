<?php
// ── api/resend-signup-otp.php ───────────────────────────────────────
// POST { email } -> re-sends the signup verification code. Same
// generic-response + rate-limit pattern as forgot-password.php, so
// this can't be used to enumerate which emails have accounts.
require_once __DIR__ . '/config.php';
ensureTable();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$body  = jsonBody();
$email = strtolower(trim($body['email'] ?? ''));

if (!filter_var($email, FILTER_VALIDATE_EMAIL))
    respond(['error' => 'Please provide a valid email address.'], 400);

$db   = getDB();
$stmt = $db->prepare('SELECT id, name, email_verified FROM pd_users WHERE email = ?');
$stmt->execute([$email]);
$user = $stmt->fetch();

$genericResponse = ['message' => 'If that account needs verification, a new 6-digit code has been sent.'];

if (!$user) respond($genericResponse);
if ($user['email_verified']) respond($genericResponse); // already verified — nothing to resend

// Rate limit: 1 request per 60 seconds per user
$rl = $db->prepare(
    "SELECT id FROM pd_otp_resets WHERE user_id = ? AND purpose = 'signup_verify'
     AND created_at > NOW() - INTERVAL '60 seconds' ORDER BY created_at DESC LIMIT 1"
);
$rl->execute([$user['id']]);
if ($rl->fetch()) {
    respond(['error' => 'Please wait a minute before requesting another code.'], 429);
}

$otp       = generateOtp();
$otpHash   = hash('sha256', $otp);
$expiresAt = date('Y-m-d H:i:s', time() + 600);

$db->prepare(
    "INSERT INTO pd_otp_resets (user_id, otp_hash, otp_expires_at, purpose) VALUES (?, ?, ?, 'signup_verify')"
)->execute([$user['id'], $otpHash, $expiresAt]);

$name = htmlspecialchars($user['name'] ?: 'there');
$html = <<<HTML
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="color:#111;">Verify your PaperDesk account</h2>
  <p>Hi {$name},</p>
  <p>Use the code below to verify your email. It expires in 10 minutes.</p>
  <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f3f3f3;padding:16px 24px;border-radius:8px;text-align:center;margin:24px 0;">{$otp}</div>
  <p>If you didn't request this, you can safely ignore this email.</p>
</div>
HTML;

$sent = sendMail($email, $user['name'] ?? '', 'Your PaperDesk verification code', $html);

if (!$sent) {
    respond(['error' => 'Could not send the email right now. Please try again shortly.'], 500);
}

respond($genericResponse);
