<?php
// ── api/angel-test.php ────────────────────────────────────────────
// STANDALONE TEST — visit this directly in your browser once you've
// filled in api/angel-config.php with real credentials:
//
//   http://localhost/paperdesk2/api/angel-test.php
//
// It logs in fresh and fetches RELIANCE's live LTP on NSE. If this
// works, the hard part (auth) is done and we can wire it into the
// real watchlist. This file isn't linked from anywhere else in the
// app — delete it once you're done testing, or leave it, it's not
// harmful, just not part of the normal user flow.
require_once __DIR__ . '/angel-config.php';
ensureTable();
requireAdminKey();

header('Content-Type: application/json');

try {
    $session = angelLogin();
    echo json_encode(['step' => 'login', 'ok' => true, 'jwtToken_preview' => substr($session['jwtToken'], 0, 20) . '...']) . "\n\n";

    // RELIANCE-EQ on NSE — hardcoded token 2885 for this quick test.
    // Once pd_instruments is imported, tokens come from that table
    // instead of being hardcoded like this.
    $ltp = angelRequest('POST', '/rest/secure/angelbroking/order/v1/getLtpData', [
        'exchange'      => 'NSE',
        'tradingsymbol' => 'RELIANCE-EQ',
        'symboltoken'   => '2885',
    ], $session['jwtToken']);

    echo json_encode(['step' => 'ltp', 'ok' => true, 'response' => $ltp], JSON_PRETTY_PRINT);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
