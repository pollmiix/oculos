<?php
declare(strict_types=1);

function visitor_ip(): string
{
    // Only trust forwarding headers supplied by the hosting platform.
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if (getenv('VERCEL') === '1') {
        $ip = trim(explode(',', (string)($_SERVER['HTTP_X_VERCEL_FORWARDED_FOR'] ?? $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $ip))[0]);
    }
    return filter_var($ip, FILTER_VALIDATE_IP) ? inet_ntop(inet_pton($ip)) : '';
}

function visitor_blocked(string $ip): bool
{
    if ($ip === '') return false;
    $query = db()->prepare('SELECT 1 FROM visitor_ip_blocks WHERE ip_address=?');
    $query->execute([$ip]);
    return (bool)$query->fetchColumn();
}

function visitor_agent(string $agent): array
{
    $platform = match (true) {
        (bool)preg_match('/android/i', $agent) => 'Android',
        (bool)preg_match('/iphone|ipad|ipod/i', $agent) => 'iOS',
        (bool)preg_match('/windows/i', $agent) => 'Windows',
        (bool)preg_match('/macintosh|mac os/i', $agent) => 'macOS',
        (bool)preg_match('/linux/i', $agent) => 'Linux',
        default => 'Desconhecido',
    };
    $browser = match (true) {
        (bool)preg_match('/edg[eaios]*\//i', $agent) => 'Edge',
        (bool)preg_match('/opr\/|opera/i', $agent) => 'Opera',
        (bool)preg_match('/firefox|fxios/i', $agent) => 'Firefox',
        (bool)preg_match('/chrome|crios/i', $agent) => 'Chrome',
        (bool)preg_match('/safari/i', $agent) => 'Safari',
        default => 'Desconhecido',
    };
    return [$platform, $browser];
}

function record_visitor(array $event): void
{
    $ip = visitor_ip();
    [$platform, $browser] = visitor_agent((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $location = [];
    if (getenv('VERCEL') === '1') {
        foreach (['HTTP_X_VERCEL_IP_CITY', 'HTTP_X_VERCEL_IP_COUNTRY_REGION', 'HTTP_X_VERCEL_IP_COUNTRY'] as $header) {
            $part = trim(rawurldecode((string)($_SERVER[$header] ?? '')));
            if ($part !== '') $location[] = substr($part, 0, 80);
        }
    }
    $query = db()->prepare('INSERT INTO visitor_sessions(session_id,first_seen,last_seen,ip_address,platform,browser,device,page_path,source,event_name,product_id,location) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE last_seen=VALUES(last_seen),ip_address=VALUES(ip_address),platform=VALUES(platform),browser=VALUES(browser),device=VALUES(device),page_path=VALUES(page_path),source=VALUES(source),event_name=IF(VALUES(event_name)=\'heartbeat\',event_name,VALUES(event_name)),product_id=IF(VALUES(event_name)=\'heartbeat\',product_id,VALUES(product_id)),location=VALUES(location)');
    $query->execute([$event['sessionId'], time(), time(), $ip, $platform, $browser,
        substr((string)($event['device'] ?? 'unknown'), 0, 30), $event['page'],
        substr((string)($event['source'] ?? 'direct'), 0, 180), $event['name'],
        substr((string)($event['productId'] ?? ''), 0, 120), implode(' / ', $location)]);
    $retention = max(30, min(365, (int)config_value('analytics_retention_days', '90')));
    db()->prepare('DELETE FROM visitor_sessions WHERE last_seen < ?')->execute([time() - $retention * 86400]);
}

function visitor_list(int $page, string $filter = ''): array
{
    $pdo = db();
    $where = match ($filter) {
        'online' => 'v.last_seen>=' . (time() - 90) . ' AND b.ip_address IS NULL',
        'blocked' => 'b.ip_address IS NOT NULL',
        default => '1=1',
    };
    $join = ' FROM visitor_sessions v LEFT JOIN visitor_ip_blocks b ON b.ip_address=v.ip_address';
    $total = (int)$pdo->query('SELECT COUNT(*)' . $join . ' WHERE ' . $where)->fetchColumn();
    $pages = max(1, (int)ceil($total / 25));
    $page = max(1, min($pages, $page));
    $offset = ($page - 1) * 25;
    $rows = $pdo->query('SELECT v.*,b.ip_address AS blocked_ip,o.id AS order_id,o.payment_status,o.created_at AS order_created,o.total_cents,o.items_json'
        . $join . ' LEFT JOIN orders o ON o.id=(SELECT id FROM orders WHERE analytics_session_id=v.session_id ORDER BY created_at DESC,id DESC LIMIT 1)'
        . ' WHERE ' . $where . " ORDER BY v.last_seen DESC,v.session_id LIMIT 25 OFFSET {$offset}")->fetchAll();
    $products = [];
    foreach ((store_value()['produtos'] ?? []) as $product) $products[(string)$product['id']] = $product['nome'] ?? '';
    foreach ($rows as &$row) {
        $row['blocked'] = $row['blocked_ip'] !== null;
        $row['online'] = !$row['blocked'] && (int)$row['last_seen'] >= time() - 90;
        $row['product_name'] = $products[$row['product_id']] ?? $row['product_id'];
        if ($row['product_name'] === '' && $row['order_id']) {
            $items = json_decode($row['items_json'] ?? '[]', true);
            $row['product_name'] = implode(' · ', array_filter(array_map(static fn($item) => is_array($item) ? ($item['name'] ?? '') : '', is_array($items) ? $items : [])));
        }
        unset($row['blocked_ip'], $row['items_json']);
    }
    unset($row);
    $online = (int)$pdo->query('SELECT COUNT(*)' . $join . ' WHERE v.last_seen>=' . (time() - 90) . ' AND b.ip_address IS NULL')->fetchColumn();
    return ['visits' => $rows, 'page' => $page, 'pages' => $pages, 'total' => $total,
        'summary' => ['visits' => (int)$pdo->query('SELECT COUNT(*) FROM visitor_sessions')->fetchColumn(),
            'online' => $online, 'blocked' => (int)$pdo->query('SELECT COUNT(*) FROM visitor_ip_blocks')->fetchColumn()], 'serverTime' => time()];
}

function visitor_action(array $data): void
{
    $action = $data['action'] ?? '';
    $pdo = db();
    if ($action === 'unblock_all') {
        $pdo->exec('DELETE FROM visitor_ip_blocks');
        return;
    }
    if (!in_array($action, ['block', 'unblock', 'delete'], true)) throw new InvalidArgumentException('Ação de visita inválida.');
    $sessionId = required_text($data['sessionId'] ?? null, 'visita', 36);
    $query = $pdo->prepare('SELECT ip_address FROM visitor_sessions WHERE session_id=?');
    $query->execute([$sessionId]);
    $ip = $query->fetchColumn();
    if ($ip === false) throw new InvalidArgumentException('Visita não encontrada. Atualize a lista.');
    if ($action === 'delete') {
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM events WHERE session_id=?')->execute([$sessionId]);
            $pdo->prepare('DELETE FROM visitor_sessions WHERE session_id=?')->execute([$sessionId]);
            $pdo->commit();
        } catch (Throwable $error) {
            $pdo->rollBack();
            throw $error;
        }
    } elseif ($action === 'block') {
        if (!filter_var($ip, FILTER_VALIDATE_IP)) throw new InvalidArgumentException('Esta visita não possui um IP válido.');
        $pdo->prepare('INSERT INTO visitor_ip_blocks(ip_address,created_at) VALUES(?,?) ON DUPLICATE KEY UPDATE created_at=VALUES(created_at)')->execute([$ip, time()]);
    } else {
        $pdo->prepare('DELETE FROM visitor_ip_blocks WHERE ip_address=?')->execute([$ip]);
    }
}
