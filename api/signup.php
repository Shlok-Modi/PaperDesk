<?php
// ── api/signup.php ────────────────────────────────────────────────
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

ensureTable();

$body     = jsonBody();
$name     = trim($body['name']     ?? '');
$email    = strtolower(trim($body['email']    ?? ''));
$password = $body['password'] ?? '';

if (!$name || !$email || !$password)
    respond(['error' => 'Name, email and password are required.'], 400);
if (strlen($name) < 2)
    respond(['error' => 'Name must be at least 2 characters.'], 400);
if (!filter_var($email, FILTER_VALIDATE_EMAIL))
    respond(['error' => 'Please provide a valid email address.'], 400);
if ($pwError = validatePasswordPolicy($password))
    respond(['error' => $pwError], 400);

$db = getDB();

// Check duplicate
$chk = $db->prepare('SELECT id FROM pd_users WHERE email = ?');
$chk->execute([$email]);
if ($chk->fetch())
    respond(['error' => 'An account with this email already exists.'], 409);

// Insert — email_verified = FALSE until the OTP below is confirmed
// (see verify-signup-otp.php). This is what proves the person signing
// up actually owns this email address, not just typed one in.
$hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
$stmt = $db->prepare(
    'INSERT INTO pd_users (name, email, password_hash, email_verified)
     VALUES (?, ?, ?, FALSE)
     RETURNING id, name, email, balance, created_at'
);
$stmt->execute([$name, $email, $hash]);
$user = $stmt->fetch();

if (!$user)
    respond(['error' => 'Failed to create account. Please try again.'], 500);

auditLog($user['id'], 'signup', $email);

// Send the verification OTP (same helper/table as password reset,
// distinguished by purpose).
$otp       = generateOtp();
$otpHash   = hash('sha256', $otp);
$expiresAt = date('Y-m-d H:i:s', time() + 600); // 10 minutes

$db->prepare(
    "INSERT INTO pd_otp_resets (user_id, otp_hash, otp_expires_at, purpose) VALUES (?, ?, ?, 'signup_verify')"
)->execute([$user['id'], $otpHash, $expiresAt]);

$safeName = htmlspecialchars($name);
$html = <<<HTML
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="color:#111;">Verify your PaperDesk account</h2>
  <p>Hi {$safeName},</p>
  <p>Use the code below to verify your email and finish creating your account. It expires in 10 minutes.</p>
  <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f3f3f3;padding:16px 24px;border-radius:8px;text-align:center;margin:24px 0;">{$otp}</div>
  <p>If you didn't sign up for PaperDesk, you can safely ignore this email.</p>
</div>
HTML;

$sent = sendMail($email, $name, 'Verify your PaperDesk account', $html);

if (!$sent) {
    // Account exists but the OTP email failed to send — don't leave
    // the user stuck with no way to ever verify. They can retry via
    // the "resend code" button, which re-sends regardless.
    respond([
        'message'              => 'Account created, but we could not send the verification email. Use "Resend code" on the next screen to try again.',
        'requiresVerification' => true,
        'email'                => $email,
    ], 201);
}

respond([
    'message'              => 'Account created. Check your email for a 6-digit verification code.',
    'requiresVerification' => true,
    'email'                => $email,
], 201);
