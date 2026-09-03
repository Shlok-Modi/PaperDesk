<?php
// ── api/google-login.php ──────────────────────────────────────────
// Handles both sign-in AND sign-up via Google — same endpoint, since
// Google Identity Services always gives us a verified email either way.
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

ensureTable();

$body    = jsonBody();
$idToken = $body['credential'] ?? '';

if (!$idToken)
    respond(['error' => 'Missing Google credential.'], 400);

$payload = verifyGoogleToken($idToken);
if (!$payload) {
    auditLog(null, 'google_login_failed');
    respond(['error' => 'Google sign-in failed. Please try again.'], 401);
}

$googleId = $payload['sub'];
$email    = strtolower(trim($payload['email']));
$name     = $payload['name'] ?? explode('@', $email)[0];
$picture  = $payload['picture'] ?? null;

$db = getDB();

// 1) Already linked to this Google account? Log straight in.
$stmt = $db->prepare('SELECT * FROM pd_users WHERE google_id = ?');
$stmt->execute([$googleId]);
$user = $stmt->fetch();

if (!$user) {
    // 2) An account with this email already exists (signed up with a
    //    password previously) — link the Google ID to it rather than
    //    creating a duplicate account.
    $stmt = $db->prepare('SELECT * FROM pd_users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();

    if ($user) {
        // Google just proved this person owns the email, so if the
        // account was still pending its own signup OTP, this
        // satisfies that requirement too.
        $upd = $db->prepare('UPDATE pd_users SET google_id = ?, email_verified = TRUE, picture_url = ? WHERE id = ?');
        $upd->execute([$googleId, $picture, $user['id']]);
        $user['picture_url'] = $picture;
    } else {
        // 3) Brand new user — create a Google-only account (no password).
        $stmt = $db->prepare(
            'INSERT INTO pd_users (name, email, password_hash, google_id, auth_provider, picture_url)
             VALUES (?, ?, NULL, ?, ?, ?)
             RETURNING id, name, email, balance, created_at, picture_url'
        );
        $stmt->execute([$name, $email, $googleId, 'google', $picture]);
        $user = $stmt->fetch();
    }
} else {
    // Already-linked account signing in again — refresh the cached
    // picture in case they changed their Google photo since last login.
    $upd = $db->prepare('UPDATE pd_users SET picture_url = ? WHERE id = ?');
    $upd->execute([$picture, $user['id']]);
    $user['picture_url'] = $picture;
}

if (!$user)
    respond(['error' => 'Failed to sign in with Google. Please try again.'], 500);

auditLog($user['id'], 'google_login', $email);
$db->prepare('UPDATE pd_users SET last_login_at = NOW() WHERE id = ?')->execute([$user['id']]);
$user['last_login_at'] = date('c');

respond([
    'user'    => safeUser($user),
    'token'   => generateJWT($user['id']),
    'message' => 'Signed in with Google',
]);
