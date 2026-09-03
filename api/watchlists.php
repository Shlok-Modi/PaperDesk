<?php
// ── api/watchlists.php ────────────────────────────────────────────
// GET                          -> all watchlists + items for the user
//                                  (auto-creates "Watchlist 1" if none exist)
// POST ?action=create          { name }               -> new watchlist (max 6)
// POST ?action=rename          { id, name }           -> rename a watchlist
// POST ?action=delete          { id }                 -> delete a watchlist (min 1 must remain)
// POST ?action=add_item        { id, symbol, exch }   -> add a symbol to a watchlist
// POST ?action=remove_item     { id, symbol }         -> remove a symbol from a watchlist
require_once __DIR__ . '/config.php';
ensureTable();

const WL_MAX = 6;

$userId = requireAuth();
$db     = getDB();

function fetchWatchlists(PDO $db, string $userId): array {
    $stmt = $db->prepare(
        'SELECT id, name, sort_order FROM pd_watchlists WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC'
    );
    $stmt->execute([$userId]);
    $lists = $stmt->fetchAll();

    if (!$lists) {
        // First-time user — seed a default watchlist
        $ins = $db->prepare(
            'INSERT INTO pd_watchlists (user_id, name, sort_order) VALUES (?, ?, 0) RETURNING id, name, sort_order'
        );
        $ins->execute([$userId, 'Watchlist 1']);
        $lists = [$ins->fetch()];
    }

    $itemStmt = $db->prepare('SELECT symbol, exch FROM pd_watchlist_items WHERE watchlist_id = ? ORDER BY added_at ASC');
    foreach ($lists as &$list) {
        $itemStmt->execute([$list['id']]);
        $list['items'] = $itemStmt->fetchAll();
    }
    return $lists;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? null;

if ($method === 'GET') {
    respond(['watchlists' => fetchWatchlists($db, $userId)]);
}

if ($method !== 'POST') {
    respond(['error' => 'Method not allowed'], 405);
}

$body = jsonBody();

switch ($action) {

    case 'create': {
        $name = trim($body['name'] ?? '');
        if ($name === '') respond(['error' => 'Name is required.'], 400);

        $countStmt = $db->prepare('SELECT COUNT(*) AS c FROM pd_watchlists WHERE user_id = ?');
        $countStmt->execute([$userId]);
        if ((int) $countStmt->fetch()['c'] >= WL_MAX) {
            respond(['error' => 'You can have at most ' . WL_MAX . ' watchlists.'], 400);
        }

        $maxOrderStmt = $db->prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM pd_watchlists WHERE user_id = ?');
        $maxOrderStmt->execute([$userId]);
        $nextOrder = ((int) $maxOrderStmt->fetch()['m']) + 1;

        $ins = $db->prepare(
            'INSERT INTO pd_watchlists (user_id, name, sort_order) VALUES (?, ?, ?) RETURNING id, name, sort_order'
        );
        $ins->execute([$userId, substr($name, 0, 40), $nextOrder]);
        respond(['watchlist' => $ins->fetch() + ['items' => []]]);
    }

    case 'rename': {
        $id   = $body['id'] ?? '';
        $name = trim($body['name'] ?? '');
        if (!$id || $name === '') respond(['error' => 'id and name are required.'], 400);

        $stmt = $db->prepare('UPDATE pd_watchlists SET name = ? WHERE id = ? AND user_id = ? RETURNING id, name');
        $stmt->execute([substr($name, 0, 40), $id, $userId]);
        $row = $stmt->fetch();
        if (!$row) respond(['error' => 'Watchlist not found.'], 404);
        respond(['watchlist' => $row]);
    }

    case 'delete': {
        $id = $body['id'] ?? '';
        if (!$id) respond(['error' => 'id is required.'], 400);

        $countStmt = $db->prepare('SELECT COUNT(*) AS c FROM pd_watchlists WHERE user_id = ?');
        $countStmt->execute([$userId]);
        if ((int) $countStmt->fetch()['c'] <= 1) {
            respond(['error' => 'You must keep at least one watchlist.'], 400);
        }

        $stmt = $db->prepare('DELETE FROM pd_watchlists WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $userId]);
        respond(['message' => 'Watchlist deleted.']);
    }

    case 'add_item': {
        $id     = $body['id'] ?? '';
        $symbol = strtoupper(trim($body['symbol'] ?? ''));
        $exch   = strtoupper(trim($body['exch'] ?? 'NSE'));
        if (!$id || $symbol === '') respond(['error' => 'id and symbol are required.'], 400);

        // Confirm ownership
        $own = $db->prepare('SELECT id FROM pd_watchlists WHERE id = ? AND user_id = ?');
        $own->execute([$id, $userId]);
        if (!$own->fetch()) respond(['error' => 'Watchlist not found.'], 404);

        // Validate against the real instrument master — rejects
        // arbitrary/unknown strings (also closes an XSS vector: symbol
        // is rendered unescaped client-side, so only real instrument
        // symbols, which are controlled data, should ever reach it).
        $instCheck = $db->prepare('SELECT 1 FROM pd_instruments WHERE symbol = ? AND exch = ?');
        $instCheck->execute([$symbol, $exch]);
        if (!$instCheck->fetch()) respond(['error' => 'Unknown instrument.'], 400);

        // Cap items per watchlist — an unbounded list inflates every
        // refreshQuotes() call (polled every 8s) and the Angel One
        // batch quote calls behind it.
        $wlItemsMax = 100;
        $itemCount = $db->prepare('SELECT COUNT(*) AS c FROM pd_watchlist_items WHERE watchlist_id = ?');
        $itemCount->execute([$id]);
        if ((int) $itemCount->fetch()['c'] >= $wlItemsMax) {
            respond(['error' => 'This watchlist is full (max ' . $wlItemsMax . ' symbols).'], 400);
        }

        try {
            $ins = $db->prepare(
                'INSERT INTO pd_watchlist_items (watchlist_id, symbol, exch) VALUES (?, ?, ?)
                 ON CONFLICT (watchlist_id, symbol) DO NOTHING'
            );
            $ins->execute([$id, $symbol, $exch]);
        } catch (PDOException $e) {
            respond(['error' => 'Could not add symbol.'], 500);
        }
        respond(['message' => 'Symbol added.']);
    }

    case 'remove_item': {
        $id     = $body['id'] ?? '';
        $symbol = strtoupper(trim($body['symbol'] ?? ''));
        if (!$id || $symbol === '') respond(['error' => 'id and symbol are required.'], 400);

        $own = $db->prepare('SELECT id FROM pd_watchlists WHERE id = ? AND user_id = ?');
        $own->execute([$id, $userId]);
        if (!$own->fetch()) respond(['error' => 'Watchlist not found.'], 404);

        $del = $db->prepare('DELETE FROM pd_watchlist_items WHERE watchlist_id = ? AND symbol = ?');
        $del->execute([$id, $symbol]);
        respond(['message' => 'Symbol removed.']);
    }

    default:
        respond(['error' => 'Unknown or missing action.'], 400);
}
