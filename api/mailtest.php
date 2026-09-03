<?php
// ── api/mailtest.php ────────────────────────────────────────────────
// Quick SMTP connectivity + send test. Visit directly in your browser:
//   http://localhost/paperdesk2/api/mailtest.php?key=YOUR_PD_ADMIN_KEY&to=you@example.com
// Gated by PD_ADMIN_KEY like dbtest.php — shows the real PHPMailer
// error instead of the silently-logged failure normal endpoints give.
require_once __DIR__ . '/config.php';
requireAdminKey();

header('Content-Type: application/json');

$to = $_GET['to'] ?? SMTP_USER;
if (!$to) {
    echo json_encode(['error' => 'Pass ?to=you@example.com, or set PD_SMTP_USER in .env so it has a default.']);
    exit;
}

require_once __DIR__ . '/PHPMailer/src/Exception.php';
require_once __DIR__ . '/PHPMailer/src/PHPMailer.php';
require_once __DIR__ . '/PHPMailer/src/SMTP.php';

$mail = new PHPMailer\PHPMailer\PHPMailer(true);
$debugLog = [];

try {
    $mail->isSMTP();
    $mail->Host       = SMTP_HOST;
    $mail->SMTPAuth   = true;
    $mail->Username   = SMTP_USER;
    $mail->Password   = SMTP_PASS;
    $mail->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    $mail->Port       = SMTP_PORT;

    // Verbose SMTP debug output, captured instead of printed, so we
    // can return the real conversation (helps spot auth vs TLS vs
    // firewall issues at a glance).
    $mail->SMTPDebug = 2;
    $mail->Debugoutput = function ($str, $level) use (&$debugLog) {
        $debugLog[] = trim($str);
    };

    $mail->setFrom(SMTP_FROM, SMTP_FROM_NAME);
    $mail->addAddress($to);
    $mail->isHTML(true);
    $mail->Subject = 'PaperDesk SMTP test';
    $mail->Body    = '<p>If you got this, your SMTP config in api/.env is working.</p>';
    $mail->AltBody = 'If you got this, your SMTP config in api/.env is working.';

    $mail->send();

    echo json_encode([
        'status' => 'SENT',
        'to'     => $to,
        'host'   => SMTP_HOST,
        'port'   => SMTP_PORT,
        'user'   => SMTP_USER,
        'smtp_conversation' => $debugLog,
    ]);
} catch (\Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'status'  => 'FAILED',
        'error'   => $e->getMessage(),
        'host'    => SMTP_HOST,
        'port'    => SMTP_PORT,
        'user'    => SMTP_USER,
        'smtp_conversation' => $debugLog,
    ]);
}
