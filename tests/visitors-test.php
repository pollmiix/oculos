<?php
declare(strict_types=1);

// Exercise production visitor logic on a disposable database. Translate only
// MySQL's upsert syntax; listing, joins, filters and deletion run unchanged.
class VisitorTestDb extends PDO {
    public function prepare(string $query, array $options = []): PDOStatement|false {
        if (str_contains($query, 'ON DUPLICATE KEY UPDATE')) {
            $key = str_starts_with($query, 'INSERT INTO visitor_sessions') ? 'session_id' : 'ip_address';
            $query = str_replace('ON DUPLICATE KEY UPDATE', "ON CONFLICT({$key}) DO UPDATE SET", $query);
            $query = preg_replace('/VALUES\((\w+)\)/', 'excluded.$1', $query);
            $query = str_replace('IF(', 'IIF(', $query);
        }
        return parent::prepare($query, $options);
    }
}
$testDb = new VisitorTestDb('sqlite::memory:');
$testDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$testDb->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
function db(): PDO { return $GLOBALS['testDb']; }
function store_value(): array { return ['produtos' => [['id' => 'glasses', 'nome' => 'Óculos de teste']]]; }
function config_value(string $key, string $default = ''): string { return $default; }
function required_text(mixed $value, string $label, int $maximum): string {
    if (!is_string($value) || !$value || strlen($value) > $maximum) throw new InvalidArgumentException($label);
    return $value;
}
function check_visit(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
require dirname(__DIR__) . '/visitors.php';
$testDb->exec('CREATE TABLE visitor_sessions(session_id TEXT PRIMARY KEY,first_seen INTEGER,last_seen INTEGER,ip_address TEXT,platform TEXT,browser TEXT,device TEXT,page_path TEXT,source TEXT,event_name TEXT,product_id TEXT,location TEXT)');
$testDb->exec('CREATE TABLE visitor_ip_blocks(ip_address TEXT PRIMARY KEY,created_at INTEGER)');
$testDb->exec('CREATE TABLE orders(id TEXT PRIMARY KEY,analytics_session_id TEXT,payment_status TEXT,created_at INTEGER,total_cents INTEGER,items_json TEXT)');
$testDb->exec('CREATE TABLE events(session_id TEXT,event_name TEXT)');
putenv('VERCEL=');
$_SERVER['REMOTE_ADDR'] = '192.0.2.4';
$_SERVER['HTTP_X_FORWARDED_FOR'] = '203.0.113.9';
check_visit(visitor_ip() === '192.0.2.4', 'Untrusted forwarded IP was accepted');
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0';
$event = ['sessionId' => 'visit-1', 'page' => '/produto.html', 'name' => 'view_item', 'productId' => 'glasses'];
record_visitor($event);
record_visitor(array_replace($event, ['name' => 'heartbeat']));
$result = visitor_list(1);
check_visit($result['total'] === 1 && $result['summary']['online'] === 1, 'Heartbeat duplicated the session or marked it offline');
check_visit($result['visits'][0]['event_name'] === 'view_item', 'Heartbeat overwrote the stage');
check_visit($result['visits'][0]['product_name'] === 'Óculos de teste', 'Product name missing');
check_visit($result['visits'][0]['platform'] === 'Windows' && $result['visits'][0]['browser'] === 'Chrome', 'Agent detection failed');
$testDb->prepare('UPDATE visitor_sessions SET last_seen=?')->execute([time() - 11]);
check_visit(visitor_list(1)['summary']['online'] === 0, 'A stale visitor must go offline after 10 seconds');
record_visitor(array_replace($event, ['name' => 'heartbeat']));
check_visit(visitor_list(1)['summary']['online'] === 1, 'A new heartbeat must restore online presence');
putenv('VERCEL=1');
$_SERVER['HTTP_X_VERCEL_FORWARDED_FOR'] = '2001:db8::1';
$_SERVER['HTTP_X_VERCEL_IP_CITY'] = 'S%C3%A3o%20Paulo';
$_SERVER['HTTP_X_VERCEL_IP_COUNTRY_REGION'] = 'SP';
$_SERVER['HTTP_X_VERCEL_IP_COUNTRY'] = 'BR';
record_visitor(array_replace($event, ['sessionId' => 'visit-geo']));
$result = visitor_list(1);
$geo = array_values(array_filter($result['visits'], fn($v) => $v['session_id'] === 'visit-geo'))[0];
check_visit($geo['ip_address'] === '2001:db8::1' && $geo['location'] === 'São Paulo / SP / BR', 'Trusted IP/location decoding failed');
putenv('VERCEL=');
for ($i = 2; $i <= 28; $i++) record_visitor(array_replace($event, ['sessionId' => 'visit-' . $i]));
check_visit(count(visitor_list(1)['visits']) === 25 && visitor_list(2)['pages'] === 2, 'Pagination failed');
visitor_action(['action' => 'block', 'sessionId' => 'visit-1']);
check_visit(visitor_blocked('192.0.2.4'), 'IP was not blocked');
check_visit(visitor_list(1, 'blocked')['total'] === 28, 'Same-IP visits were not blocked together');
visitor_action(['action' => 'unblock', 'sessionId' => 'visit-1']);
check_visit(!visitor_blocked('192.0.2.4'), 'Unblock failed');
$testDb->prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)')->execute(['order-1', 'visit-1', 'paid', time(), 15900, '[]']);
$testDb->exec("INSERT INTO events VALUES('visit-1','view_item')");
visitor_action(['action' => 'block', 'sessionId' => 'visit-1']);
visitor_action(['action' => 'delete', 'sessionId' => 'visit-1']);
check_visit((int)$testDb->query('SELECT COUNT(*) FROM events')->fetchColumn() === 0, 'Events not deleted');
check_visit($testDb->query('SELECT payment_status FROM orders')->fetchColumn() === 'paid', 'Deleting a visit changed orders');
check_visit(visitor_blocked('192.0.2.4'), 'Deleting a visit removed the IP block');
visitor_action(['action' => 'unblock_all']);
check_visit(visitor_list(1)['summary']['blocked'] === 0, 'Unblock all failed');
echo "PHP visitors: activity, pagination, location, trusted IP, blocking, deletion and payment preservation passed.\n";
