<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

class PanelReply extends RuntimeException {
    public function __construct(public int $status, public array $body) { parent::__construct('Test response'); }
}
class PanelTestDb extends PDO {
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return parent::prepare(str_replace('INSERT IGNORE INTO', 'INSERT OR IGNORE INTO', $query), $options);
    }
}
$testDb = new PanelTestDb('sqlite::memory:');
$testDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$testDb->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$testDb->sqliteCreateFunction('JSON_UNQUOTE', static fn($value) => $value);
$testDb->sqliteCreateFunction('FROM_UNIXTIME', static fn($value) => date('Y-m-d H:i:s', (int)$value));
$testDb->sqliteCreateFunction('DATE_FORMAT', static fn($value, $format) => substr((string)$value, 0, 10));
$posted = ['action' => 'archive'];
$owner = true; $csrf = true; $failAudit = false;
function db(): PDO { return $GLOBALS['testDb']; }
function require_admin(bool $write = false, array $roles = []): array {
    if (!$write || $roles !== ['owner']) throw new LogicException('Archive must require owner and CSRF');
    if (!$GLOBALS['owner'] || !$GLOBALS['csrf']) respond(403, ['error' => 'Denied']);
    return ['admin_id' => 1];
}
function json_body(int $limit): array { return $GLOBALS['posted']; }
function respond(int $status, array $body): never { throw new PanelReply($status, $body); }
function audit(int $id, string $action, string $entity): void {
    if ($GLOBALS['failAudit']) throw new RuntimeException('Test audit failure');
}
function store_value(): array { return ['produtos' => [['id' => 'glasses', 'nome' => 'Glasses', 'preco' => 10, 'estoque' => 4]]]; }
function money_cents(mixed $value): int { return (int)round((float)$value * 100); }
function check_panel(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
function panel_reply(int $status): array {
    try { archive_panel_orders(); }
    catch (PanelReply $reply) { check_panel($reply->status === $status, 'Unexpected response status'); return $reply->body; }
    throw new RuntimeException('Missing response');
}
$source = file_get_contents(dirname(__DIR__) . '/api.php');
$start = strpos($source, 'function panel_orders_condition(');
$end = strpos($source, 'function analytics_summary(', $start);
eval(substr($source, $start, $end - $start));
check_panel(strpos($source, "\$path === '/api/admin/orders/panel'") < strpos($source, "#^/api/admin/orders/([A-Za-z0-9_-]"), 'Archive route must precede the single-order route');
$testDb->exec('CREATE TABLE orders(id TEXT PRIMARY KEY,created_at INTEGER,payment_status TEXT,total_cents INTEGER,customer_json TEXT,items_json TEXT)');
$testDb->exec('CREATE TABLE order_panel_archive(order_id TEXT PRIMARY KEY,archived_at INTEGER)');
$testDb->exec('CREATE TABLE payment_transactions(transaction_id TEXT PRIMARY KEY,amount INTEGER)');
$testDb->exec('CREATE TABLE events(session_id TEXT,happened_at INTEGER)');
$insert = $testDb->prepare('INSERT INTO orders VALUES(?,?,?,?,?,?)');
$customer = json_encode(['name' => 'Example', 'email' => 'example@example.test']);
$items = json_encode([['id' => 'glasses', 'quantity' => 1]]);
$insert->execute(['paid', time(), 'paid', 1000, $customer, $items]);
$insert->execute(['pending', time(), 'pending', 2000, $customer, $items]);
$testDb->exec("INSERT INTO payment_transactions VALUES('trx-example',1000)");
$originalOrders = $testDb->query('SELECT * FROM orders ORDER BY id')->fetchAll();
$originalTransactions = $testDb->query('SELECT * FROM payment_transactions')->fetchAll();
check_panel(dashboard(30)['orders'] === 2 && product_report()[0]['paidUnits'] === 1, 'Initial indicators incorrect');
$owner = false; panel_reply(403); $owner = true;
$csrf = false; panel_reply(403); $csrf = true;
check_panel(count(orders_list()) === 2, 'Denied requests must not hide orders');
check_panel(panel_reply(200)['count'] === 2, 'Archive must cover every order');
check_panel(orders_list() === [] && count(orders_list(5000, true)) === 2, 'Archive must hide list and preserve export history');
check_panel(dashboard(30)['orders'] === 0 && dashboard(30)['customers'] === 0 && product_report()[0]['paidUnits'] === 0, 'Panel indicators must exclude archived orders');
check_panel($originalOrders === $testDb->query('SELECT * FROM orders ORDER BY id')->fetchAll(), 'Archive must preserve original orders');
check_panel($originalTransactions === $testDb->query('SELECT * FROM payment_transactions')->fetchAll(), 'Archive must not modify payment transactions');
$testDb->exec("UPDATE orders SET payment_status='paid' WHERE id='pending'");
check_panel(orders_list() === [], 'Later payment updates must not reveal archived orders');
$insert->execute(['new', time(), 'paid', 500, $customer, $items]);
check_panel(count(orders_list()) === 1 && dashboard(30)['revenueCents'] === 500, 'New orders must remain visible');
check_panel(panel_reply(200)['count'] === 1, 'Repeated archive must be idempotent');
$posted = ['action' => 'restore'];
check_panel(panel_reply(200)['count'] === 3 && count(orders_list()) === 3, 'Restore must recover every archived order');
$posted = ['action' => 'archive']; $failAudit = true;
try { archive_panel_orders(); throw new LogicException('Expected audit failure'); }
catch (LogicException $error) { throw $error; } catch (RuntimeException $expected) {}
check_panel(!$testDb->inTransaction() && count(orders_list()) === 3, 'Failure must roll back archive');
$failAudit = false; $posted = ['action' => 'invalid'];
try { archive_panel_orders(); throw new LogicException('Invalid action accepted'); }
catch (InvalidArgumentException $expected) {} catch (LogicException $error) { throw $error; }
echo "Panel archive permissions, indicators, preservation, late payment, new orders, restore and rollback tests passed.\n";
