<?php
// ── api/angel-config.php ──────────────────────────────────────────
// Angel One SmartAPI credentials + login helper.
//
// FILL THESE IN once you have them from https://smartapi.angelone.in:
//   - API_KEY:       from your SmartAPI developer app
//   - CLIENT_CODE:   your Angel One trading account client ID (e.g. "A123456")
//   - CLIENT_PIN:    your 4-digit account PIN (not your MPIN app password)
//   - TOTP_SECRET:   the base32 secret shown when you enable TOTP for
//                    API access in Angel One's app (NOT your regular
//                    2FA — this is a separate "API TOTP" setup step
//                    under Profile > Settings in the Angel One app)
//
// NEVER commit this file with real values filled in — keep it out of
// git (it's already covered by a wildcard in most .gitignore setups,
// but double check) and never paste these values into a chat.
require_once __DIR__ . '/config.php';

define('ANGEL_API_KEY',     env('PD_ANGEL_API_KEY',     'YOUR_API_KEY_HERE'));
define('ANGEL_CLIENT_CODE', env('PD_ANGEL_CLIENT_CODE', 'YOUR_CLIENT_CODE_HERE'));
define('ANGEL_CLIENT_PIN',  env('PD_ANGEL_CLIENT_PIN',  'YOUR_PIN_HERE'));
define('ANGEL_TOTP_SECRET', env('PD_ANGEL_TOTP_SECRET', 'YOUR_TOTP_SECRET_HERE'));

define('ANGEL_BASE_URL', 'https://apiconnect.angelone.in');

/**
 * Generates a 6-digit TOTP code from a base32 secret (RFC 6238 / RFC
 * 4226), the same algorithm apps like Google Authenticator use. No
 * external library needed.
 */
function generateTotp(string $base32Secret, int $timeStep = 30, int $digits = 6): string {
    $secret = base32Decode($base32Secret);
    $time   = floor(time() / $timeStep);
    $timeBin = pack('N*', 0, $time); // 8-byte big-endian counter

    $hash = hash_hmac('sha1', $timeBin, $secret, true);
    $offset = ord($hash[strlen($hash) - 1]) & 0x0F;

    $truncated = (
        ((ord($hash[$offset])     & 0x7F) << 24) |
        ((ord($hash[$offset + 1]) & 0xFF) << 16) |
        ((ord($hash[$offset + 2]) & 0xFF) << 8)  |
        (ord($hash[$offset + 3])  & 0xFF)
    );

    $otp = $truncated % (10 ** $digits);
    return str_pad((string) $otp, $digits, '0', STR_PAD_LEFT);
}

function base32Decode(string $b32): string {
    $alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    $b32 = strtoupper(rtrim($b32, '='));
    $bits = '';
    foreach (str_split($b32) as $char) {
        $pos = strpos($alphabet, $char);
        if ($pos === false) continue;
        $bits .= str_pad(decbin($pos), 5, '0', STR_PAD_LEFT);
    }
    $bytes = '';
    foreach (str_split($bits, 8) as $byte) {
        if (strlen($byte) < 8) continue;
        $bytes .= chr(bindec($byte));
    }
    return $bytes;
}

/**
 * Low-level HTTP helper for SmartAPI calls.
 */
function angelRequest(string $method, string $path, array $body = [], ?string $jwtToken = null): array {
    $ch = curl_init(ANGEL_BASE_URL . $path);
    $headers = [
        'Content-Type: application/json',
        'Accept: application/json',
        'X-UserType: USER',
        'X-SourceID: WEB',
        'X-ClientLocalIP: 127.0.0.1',
        'X-ClientPublicIP: 127.0.0.1',
        'X-MACAddress: 00:00:00:00:00:00',
        'X-PrivateKey: ' . ANGEL_API_KEY,
    ];
    if ($jwtToken) $headers[] = 'Authorization: Bearer ' . $jwtToken;

    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_POSTFIELDS     => $method === 'GET' ? null : json_encode($body),
    ]);
    $raw = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($raw === false) throw new Exception('Angel One request failed: ' . $err);
    $data = json_decode($raw, true);
    if ($data === null) throw new Exception('Angel One returned invalid JSON: ' . substr($raw, 0, 300));
    return $data;
}

/**
 * Logs in to SmartAPI (client code + PIN + fresh TOTP), returns
 * [jwtToken, feedToken, refreshToken]. Also caches it in
 * pd_angel_session so we don't have to log in on every request.
 */
function angelLogin(): array {
    $totp = generateTotp(ANGEL_TOTP_SECRET);

    $resp = angelRequest('POST', '/rest/auth/angelbroking/user/v1/loginByPassword', [
        'clientcode' => ANGEL_CLIENT_CODE,
        'password'   => ANGEL_CLIENT_PIN,
        'totp'       => $totp,
    ]);

    if (empty($resp['status']) || empty($resp['data']['jwtToken'])) {
        throw new Exception('Angel One login failed: ' . ($resp['message'] ?? json_encode($resp)));
    }

    $jwt     = $resp['data']['jwtToken'];
    $feed    = $resp['data']['feedToken'];
    $refresh = $resp['data']['refreshToken'] ?? null;

    $db = getDB();
    $db->exec("INSERT INTO pd_angel_session (id, jwt_token, feed_token, refresh_token, logged_in_at)
               VALUES (1, " . $db->quote($jwt) . ", " . $db->quote($feed) . ", " .
               ($refresh ? $db->quote($refresh) : 'NULL') . ", NOW())
               ON CONFLICT (id) DO UPDATE SET
                 jwt_token = EXCLUDED.jwt_token,
                 feed_token = EXCLUDED.feed_token,
                 refresh_token = EXCLUDED.refresh_token,
                 logged_in_at = EXCLUDED.logged_in_at");

    return ['jwtToken' => $jwt, 'feedToken' => $feed, 'refreshToken' => $refresh];
}

/**
 * Returns a valid JWT, reusing the cached session if it's less than
 * ~6 hours old (SmartAPI sessions are typically valid ~24h, but we
 * refresh conservatively), otherwise logging in again.
 */
function getAngelJwt(): string {
    $db  = getDB();
    $row = $db->query('SELECT * FROM pd_angel_session WHERE id = 1')->fetch();

    if ($row && $row['jwt_token'] && strtotime($row['logged_in_at']) > time() - 6 * 3600) {
        return $row['jwt_token'];
    }
    return angelLogin()['jwtToken'];
}
