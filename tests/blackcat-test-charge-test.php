<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/blackcat-gateway.php';
require dirname(__DIR__) . '/blackcat-test-charge.php';
class TestChargeResponse extends RuntimeException {
    public function __construct(public int $httpStatus, public array $body) { parent::__construct('HTTP response'); }
}
$pdo = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE gateway_test_charges(request_id TEXT PRIMARY KEY,admin_id INTEGER,transaction_id TEXT UNIQUE,external_ref TEXT UNIQUE,amount INTEGER,status TEXT,payload_hash TEXT,payment_json TEXT,created_at INTEGER,updated_at INTEGER)');
$pdo->exec('CREATE TABLE orders(id TEXT PRIMARY KEY,total_cents INTEGER)');
$pdo->exec("INSERT INTO orders VALUES('real-order',10000)");
$pdo->exec('CREATE TABLE settings(value TEXT)');
$pdo->exec("INSERT INTO settings VALUES('{\"stock\":12}')");
$authenticated = true; $csrfValid = true; $adminId = 1; $secretKey = 'test-only-private';
$input = []; $createCalls = 0; $getCalls = 0; $mode = 'normal'; $remoteState = 'PENDING'; $wrongAmount = false; $audits = [];
function db(): PDO { return $GLOBALS['pdo']; }
function config_value(string $key, string $default = ''): string {
    return match ($key) { 'blackcat_api_key' => $GLOBALS['secretKey'], 'app_secret' => str_repeat('s', 40), 'public_base_url' => 'https://example.com', default => $default };
}
function respond(int $status, array $body): never { throw new TestChargeResponse($status, $body); }
function require_admin(bool $write = false, array $roles = []): array {
    if (!$GLOBALS['authenticated']) respond(401, ['error' => 'Login required']);
    if ($write && !$GLOBALS['csrfValid']) respond(403, ['error' => 'Invalid CSRF']);
    return ['admin_id' => $GLOBALS['adminId']];
}
function json_body(int $limit): array { return $GLOBALS['input']; }
function rate_limited(string $bucket, int $limit, int $window): bool { return false; }
function audit(int $id, string $action, string $entity, ?string $entityId = null): void { $GLOBALS['audits'][] = [$action, $entity, $entityId]; }
function required_text(mixed $value, string $name, int $max): string {
    if (!is_string($value) || trim($value) === '' || strlen($value) > $max) throw new InvalidArgumentException('Invalid field');
    return trim($value);
}
function call_blackcat(string $path, string $method, string $key, ?array $payload = null, int $timeout = 25): array {
    if ($key !== 'test-only-private') throw new RuntimeException('Unexpected key');
    if ($method === 'POST') {
        $GLOBALS['createCalls']++;
        if ($GLOBALS['mode'] === 'timeout') throw new RuntimeException('Transport timeout');
        if ($GLOBALS['mode'] === 'rejected') return [422, ['success' => false]];
        if ($payload['amount'] !== 100 || $payload['items'][0]['unitPrice'] !== 100 || $payload['items'][0]['tangible'] !== false || isset($payload['shipping'])) throw new LogicException('Incorrect test payload');
        if (!str_starts_with($payload['postbackUrl'], 'https://example.com/api/webhooks/blackcat-test?ref=GT')) throw new LogicException('Missing callback');
        $id = 'trx-' . substr($payload['externalRef'], 2, 8);
        if ($GLOBALS['mode'] === 'early-paid-callback') {
            db()->prepare("UPDATE gateway_test_charges SET status='PAID' WHERE external_ref=?")->execute([$payload['externalRef']]);
        }
        return [201, ['success' => true, 'data' => ['transactionId' => $id, 'amount' => 100, 'status' => 'PENDING',
            'paymentData' => ['copyPaste' => '000201TEST', 'expiresAt' => '2026-10-28T12:00:00Z'], 'invoiceUrl' => 'https://example.com/pay']]];
    }
    $GLOBALS['getCalls']++;
    preg_match('#/sales/([^/]+)/status#', $path, $match);
    return [200, ['success' => true, 'data' => ['transactionId' => $match[1], 'amount' => $GLOBALS['wrongAmount'] ? 101 : 100, 'status' => $GLOBALS['remoteState']]]];
}
function check_test(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function reply_test(callable $fn, int $code): array {
    try { $fn(); } catch (TestChargeResponse $reply) {
        check_test($reply->httpStatus === $code, 'Unexpected response ' . $reply->httpStatus . ': ' . json_encode($reply->body));
        return $reply->body;
    }
    throw new RuntimeException('Missing response');
}
foreach (['1,00' => 100, '1.5' => 150, '100.00' => 10000] as $value => $cents) check_test(blackcat_test_amount($value) === $cents, 'Incorrect cents conversion');
foreach (['0.99', '100.01', '-1', '1e2', '1.001', 1] as $invalid) {
    try { blackcat_test_amount($invalid); throw new LogicException('Invalid amount accepted'); }
    catch (InvalidArgumentException $expected) {} catch (LogicException $e) { throw $e; }
}
check_test(blackcat_test_document('529.982.247-25')['type'] === 'cpf', 'Valid CPF rejected');
check_test(blackcat_test_document('11.222.333/0001-81')['type'] === 'cnpj', 'Valid CNPJ rejected');
foreach (['11111111111', '52998224724', '11222333000180'] as $invalid) {
    try { blackcat_test_document($invalid); throw new LogicException('Invalid document accepted'); }
    catch (InvalidArgumentException $expected) {} catch (LogicException $e) { throw $e; }
}
$requestId = '11111111-1111-4111-8111-111111111111';
$input = ['requestId' => $requestId, 'amount' => '1,00', 'acknowledgeRealCharge' => true,
    'customer' => ['name' => 'Pagador de teste', 'email' => 'teste@example.com', 'phone' => '11999999999', 'document' => '52998224725']];
$authenticated = false; reply_test(fn() => blackcat_test_create(), 401); $authenticated = true;
$csrfValid = false; reply_test(fn() => blackcat_test_create(), 403); $csrfValid = true;
$input['acknowledgeRealCharge'] = false;
try { blackcat_test_create(); throw new LogicException('Consent was not required'); }
catch (InvalidArgumentException $expected) {} catch (LogicException $e) { throw $e; }
check_test($createCalls === 0, 'No charge may be created without login, CSRF and consent');
$input['acknowledgeRealCharge'] = true;
$created = reply_test(fn() => blackcat_test_create(), 201);
check_test($created['data']['amount'] === 100 && $created['data']['paymentData']['copyPaste'] === '000201TEST', 'Missing Pix response');
reply_test(fn() => blackcat_test_create(), 200);
check_test($createCalls === 1, 'A repeated request must not generate a second charge');
$input['amount'] = '2,00'; reply_test(fn() => blackcat_test_create(), 409); $input['amount'] = '1,00';
$adminId = 2; reply_test(fn() => blackcat_test_status($requestId), 404); $adminId = 1;
$wrongAmount = true; reply_test(fn() => blackcat_test_status($requestId), 502); $wrongAmount = false;
$remoteState = 'PAID'; $confirmed = reply_test(fn() => blackcat_test_status($requestId), 200);
check_test($confirmed['data']['status'] === 'PAID', 'Verified payment was not recorded');
$remoteState = 'PENDING'; $confirmed = reply_test(fn() => blackcat_test_status($requestId), 200);
check_test($confirmed['data']['status'] === 'PAID', 'Delayed pending status must not undo payment');
$mode = 'timeout'; $input['requestId'] = '22222222-2222-4222-8222-222222222222';
reply_test(fn() => blackcat_test_create(), 503);
$callsAfterTimeout = $createCalls;
$retry = reply_test(fn() => blackcat_test_create(), 200);
check_test($createCalls === $callsAfterTimeout && $retry['data']['status'] === 'UNKNOWN', 'A lost response must not create duplicate charges');
$reference = 'GT' . strtoupper(str_replace('-', '', $input['requestId']));
$_GET = ['ref' => $reference, 'token' => str_repeat('0', 64)];
reply_test(fn() => blackcat_test_webhook(), 401);
$_GET['token'] = blackcat_callback_token($reference, config_value('app_secret'));
$input = ['transactionId' => 'trx-recovered', 'status' => 'PAID'];
$remoteState = 'PENDING'; reply_test(fn() => blackcat_test_webhook(), 200);
$row = blackcat_test_find('22222222-2222-4222-8222-222222222222', 1);
check_test($row['transaction_id'] === 'trx-recovered' && $row['status'] === 'PENDING', 'Signed callback must recover transaction but must not trust posted PAID');
$remoteState = 'PAID'; reply_test(fn() => blackcat_test_webhook(), 200);
reply_test(fn() => blackcat_test_webhook(), 200);
check_test((int)$pdo->query('SELECT COUNT(*) FROM orders')->fetchColumn() === 1, 'Test charges must not create product orders');
check_test($pdo->query('SELECT value FROM settings')->fetchColumn() === '{"stock":12}', 'Test charges must not alter catalog or stock');
$stored = $pdo->query('SELECT payment_json FROM gateway_test_charges WHERE payment_json IS NOT NULL')->fetchColumn();
check_test(!str_contains($stored, '52998224725') && !str_contains($stored, 'teste@example.com'), 'Payer personal data must not be stored in the test row');
$input = ['requestId' => '33333333-3333-4333-8333-333333333333', 'amount' => '1,00', 'acknowledgeRealCharge' => true,
    'customer' => ['name' => 'Pagador de teste', 'email' => 'teste@example.com', 'phone' => '11999999999', 'document' => '52998224725']];
$mode = 'early-paid-callback';
$early = reply_test(fn() => blackcat_test_create(), 201);
check_test($early['data']['status'] === 'PAID', 'An early verified callback must not be overwritten by the pending creation response');
$mode = 'rejected'; $input['requestId'] = '44444444-4444-4444-8444-444444444444';
reply_test(fn() => blackcat_test_create(), 422);
check_test(blackcat_test_find($input['requestId'], 1)['status'] === 'FAILED', 'Rejected charge must be recorded as failed');
echo "Real-charge consent, cents, documents, ownership, idempotency, timeout recovery, verified status and stock isolation tests passed.\n";
