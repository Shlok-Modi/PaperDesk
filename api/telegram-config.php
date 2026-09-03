<?php
// ── api/telegram-config.php ───────────────────────────────────────
// Fill in your bot token below (from @BotFather — see setup steps
// you were given). Never commit this file with a real token filled
// in, never paste it in chat.
require_once __DIR__ . '/config.php';

define('TELEGRAM_BOT_TOKEN', env('PD_TELEGRAM_BOT_TOKEN', 'YOUR_BOT_TOKEN_HERE'));
// The bot's @username (without the @) — shown in BotFather right
// after you create the bot, e.g. if BotFather says your bot is
// @PaperDeskAlertsBot, put 'PaperDeskAlertsBot' here.
define('TELEGRAM_BOT_USERNAME', env('PD_TELEGRAM_BOT_USERNAME', 'YOUR_BOT_USERNAME_HERE'));

/**
 * Sends a plain-text message to a specific Telegram chat via the Bot
 * API. Returns true on success, false on failure (never throws —
 * a failed alert send shouldn't crash the engine loop).
 */
function sendTelegramMessage(string $chatId, string $text): bool {
    if (TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE' || !$chatId) return false;

    $url = "https://api.telegram.org/bot" . TELEGRAM_BOT_TOKEN . "/sendMessage";
    $ch  = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query([
            'chat_id'    => $chatId,
            'text'       => $text,
            'parse_mode' => 'HTML',
        ]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
    ]);
    $raw = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($raw === false) {
        error_log('Telegram send failed: ' . $err);
        return false;
    }
    $resp = json_decode($raw, true);
    if (empty($resp['ok'])) {
        error_log('Telegram send rejected: ' . $raw);
        return false;
    }
    return true;
}
