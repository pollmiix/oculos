<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
// Run the production state updater against a disposable database. SQLite has
// no FOR UPDATE clause; MySQL uses that lock to serialize concurrent callbacks.
class PaymentTestDb extends PDO {
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return parent::prepare(str_replace(' FOR UPDATE', '', $query), $options);
    }
}
$testDb = new PaymentTestDb('sqlite::memory:');
$testDb->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$testDb->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
function db(): PDO { return $GLOBALS['testDb']; }
$source = file_get_contents(dirname(__DIR__) . '/api.php');
$start = strpos($source, 'function update_payment(');
$end = strpos($source, 'function orders_list(', $start);
eval(substr($source, $start, $end - $start));
$testDb->exec('CREATE TABLE orders(id TEXT PRIMARY KEY,transaction_id TEXT,payment_status TEXT,status TEXT,analytics_session_id TEXT)');
$testDb->exec('CREATE TABLE events(event_name TEXT,happened_at INTEGER,session_id TEXT,page_path TEXT,source TEXT,device TEXT,browser TEXT)');
$testDb->exec("INSERT INTO orders VALUES('order-1','trx-1','pending','awaiting_payment','session-1')");
$testDb->exec("INSERT INTO events VALUES('page_view',1,'session-1','/','direct','desktop','test')");
function payment_check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
payment_check(update_payment('trx-1', 'PAID', true), 'First confirmation failed');
payment_check(update_payment('trx-1', 'PAID', true), 'Duplicate confirmation failed');
payment_check((int)$testDb->query("SELECT COUNT(*) FROM events WHERE event_name='purchase'")->fetchColumn() === 1, 'Duplicate callbacks must not duplicate purchase events');
update_payment('trx-1', 'PENDING', true);
update_payment('trx-1', 'CANCELLED', true);
payment_check($testDb->query("SELECT payment_status FROM orders WHERE id='order-1'")->fetchColumn() === 'paid', 'Delayed pending state must not undo a paid order');
update_payment('trx-1', 'REFUNDED', true);
update_payment('trx-1', 'PAID', true);
update_payment('trx-1', 'CANCELLED', true);
payment_check($testDb->query("SELECT payment_status FROM orders WHERE id='order-1'")->fetchColumn() === 'refunded', 'A delayed paid callback must not undo a refund');
payment_check(update_payment('missing', 'PAID', true) === false, 'Unknown transactions must not be confirmed');
$testDb->exec("INSERT INTO orders VALUES('order-2','trx-2','pending','awaiting_payment','session-2')");
$testDb->exec('DROP TABLE events');
try { update_payment('trx-2', 'PAID', true); throw new LogicException('Expected a failed write'); }
catch (LogicException $error) { throw $error; } catch (PDOException $expected) {}
payment_check(!$testDb->inTransaction(), 'Failed updates must roll back');
payment_check($testDb->query("SELECT payment_status FROM orders WHERE id='order-2'")->fetchColumn() === 'pending', 'Failed updates must preserve the previous state');
echo "Payment idempotency, delayed callbacks, refund and rollback tests passed.\n";
