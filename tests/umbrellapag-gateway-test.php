<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

require dirname(__DIR__) . '/gateway-test-charge.php';
// Load production behavior with a fake HTTP boundary. No real charge is created.
$source = file_get_contents(dirname(__DIR__) . '/umbrellapag-gateway.php');
$start = strpos($source, 'function call_umbrellapag(');
$end = strpos($source, 'function umbrellapag_payload(', $start);
eval(substr(substr($source, 0, $start) . substr($source, $end), 5));
$api = file_get_contents(dirname(__DIR__) . '/api.php');
$start = strpos($api, 'function create_gateway_payment(');
$end = strpos($api, 'function export_csv(', $start);
eval(substr($api, $start, $end - $start));
class UmbrellaReply extends RuntimeException {
    public function __construct(public int $codeStatus, public array $body) { parent::__construct('HTTP response'); }
}
class UmbrellaDb extends PDO {
    public function prepare(string $sql, array $options = []): PDOStatement|false {
        return parent::prepare(str_replace(' FOR UPDATE', '', $sql), $options);
    }
}
$pdo = new UmbrellaDb('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$pdo->exec('CREATE TABLE orders(id TEXT PRIMARY KEY,transaction_id TEXT,payment_method TEXT,total_cents INTEGER,pix_payload TEXT)');
$pdo->exec('CREATE TABLE payment_transactions(transaction_id TEXT PRIMARY KEY,amount INTEGER,external_ref TEXT,created_at INTEGER)');
$pdo->exec('CREATE TABLE settings(`key` TEXT PRIMARY KEY,`value` TEXT,updated_at INTEGER)');
$pdo->exec('CREATE TABLE gateway_test_charges(request_id TEXT PRIMARY KEY,admin_id INTEGER,transaction_id TEXT UNIQUE,external_ref TEXT UNIQUE,amount INTEGER,status TEXT,payload_hash TEXT,payment_json TEXT,created_at INTEGER,updated_at INTEGER)');
$store = ['produtos' => [['id' => 'glasses']], 'pagamento' => ['metodo' => 'gateway', 'gateway' => ['provedor' => 'RetiredGateway']]];
$pdo->prepare('INSERT INTO settings VALUES(?,?,?)')->execute(['store', json_encode($store), time()]);
$config = ['umbrellapag_api_key' => 'umbrella-test-only', 'app_secret' => str_repeat('s', 40), 'public_base_url' => 'https://example.com'];
$owner = true; $posted = []; $updates = []; $requests = []; $remoteState = 'WAITING_PAYMENT'; $wrongAmount = false; $sellerBlocked = false; $pixEnabled = true; $transportFailure = false; $rejectCreation = false;
function db(): PDO { return $GLOBALS['pdo']; }
function config_value(string $key, string $default = ''): string { return $GLOBALS['config'][$key] ?? $default; }
function store_value(): array { return $GLOBALS['store']; }
function safe_store(array $store): array { return $store; }
function json_body(int $limit): array { return $GLOBALS['posted']; }
function respond(int $status, array $body): never { throw new UmbrellaReply($status, $body); }
function require_admin(bool $write = false, array $roles = []): array {
    if (!$GLOBALS['owner']) respond(403, ['error' => 'Denied']);
    return ['admin_id' => 1];
}
function rate_limited(string $bucket, int $count, int $window): bool { return false; }
function audit(int $id, string $action, string $kind, ?string $entity = null): void {}
function required_text(mixed $value, string $field, int $max): string {
    if (!is_string($value) || trim($value) === '' || strlen($value) > $max) throw new InvalidArgumentException('Invalid field');
    return trim($value);
}
function create_order_items(array $requested, array $store, bool $gateway): array {
    return [[['id' => 'glasses', 'name' => 'Glasses', 'quantity' => 1, 'unitPriceCents' => 12345]], 12345,
        [['title' => 'Glasses', 'unitPrice' => 12345, 'quantity' => 1, 'tangible' => true, 'externalRef' => 'glasses']]];
}
function analytics_session(?string $id): ?string { return null; }
function create_order(string $id, ?string $trx, string $state, string $payment, string $method, int $total, array $customer, array $items, ?string $analytics, ?string $pix): void {
    db()->prepare('INSERT INTO orders VALUES(?,?,?,?,?)')->execute([$id, $trx, $method, $total, $pix]);
}
function update_payment(string $id, string $state, bool $transaction): bool { $GLOBALS['updates'][] = [$id, $state, $transaction]; return true; }
function call_umbrellapag(string $path, string $method, string $key, ?array $payload = null, int $timeout = 25): array {
    if ($key === '') throw new RuntimeException('Missing key');
    if ($key !== 'umbrella-test-only') throw new LogicException('Wrong key');
    $GLOBALS['requests'][] = ['umbrellapag', $path, $method, $payload];
    if ($GLOBALS['transportFailure']) throw new RuntimeException('Timeout');
    if ($path === '/user/sellers') return [200, ['data' => ['legalName' => 'Test Seller', 'blocked' => $GLOBALS['sellerBlocked'], 'permissions' => ['isPixAvailable' => $GLOBALS['pixEnabled']]]]];
    if ($method === 'POST') {
        foreach ($payload['items'] as $item) check_umbrella(!empty($item['externalRef']), 'Missing item reference in Umbrella request');
        if ($GLOBALS['rejectCreation']) return [422, ['message' => ['customer.address must be an object', 'Test Payer test@example.com umbrella-test-only'], 'errors' => ['amount' => ['amount must be at least 500']]]];
    }
    $isTest = $payload !== null && str_starts_with($payload['customer']['externalRef'], 'GU');
    $id = $method === 'POST' ? ($isTest ? 'test-trx' : 'new-trx') : basename($path);
    $amount = $method === 'POST' ? $payload['amount'] : ($id === 'test-trx' ? 100 : 12345);
    return [$method === 'POST' ? 201 : 200, ['status' => 200, 'error' => null, 'data' => [
        'id' => $id, 'amount' => $amount + ($GLOBALS['wrongAmount'] ? 1 : 0), 'currency' => 'BRL',
        'paymentMethod' => 'PIX', 'status' => $GLOBALS['remoteState'], 'refusedReason' => $GLOBALS['remoteState'] === 'REFUSED' ? '{"code":"TEST_PROVIDER_REFUSAL"}' : null, 'pix' => ['qrcode' => '000201TESTPIX']]]];
}
function check_umbrella(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function reply_umbrella(callable $fn, int $expected): array {
    try { $fn(); } catch (UmbrellaReply $reply) {
        check_umbrella($reply->codeStatus === $expected, 'Unexpected response: ' . $reply->codeStatus . ' ' . json_encode($reply->body));
        return $reply->body;
    }
    throw new RuntimeException('Missing response');
}
$diagnostic = umbrellapag_rejection(422, ['message' => ['customer.address is required', 'Payer Name payer@example.com 123.456.789-00'], 'error' => ['message' => 'secret-test-value'], 'errors' => ['amount' => ['amount must be at least 500']]], ['Payer Name', 'secret-test-value']);
check_umbrella(str_contains($diagnostic, 'HTTP 422') && str_contains($diagnostic, 'customer.address') && str_contains($diagnostic, 'amount must be at least 500'), 'Gateway validation details were lost');
foreach (['Payer Name', 'payer@example.com', '123.456.789-00', 'secret-test-value'] as $secret) check_umbrella(!str_contains($diagnostic, $secret), 'Private data leaked in diagnostic');
check_umbrella(str_contains(umbrellapag_rejection(400, []), 'não informou o motivo'), 'Missing gateway detail has no fallback');
$internalReason = umbrellapag_rejection(400, ['message' => 'Transacao recusada, consulte o motivo.', 'data' => ['refusedReason' => '{"code":"ERR_INVALID_ARG_TYPE","message":"Detailed provider reason"}']]);
check_umbrella(str_contains($internalReason, 'ERR_INVALID_ARG_TYPE') && str_contains($internalReason, 'Detailed provider reason'), 'Nested gateway refusal reason was dropped');
$owner = false;
reply_umbrella(fn() => umbrellapag_inspect_transaction('existing-trx'), 403);
$owner = true;
reply_umbrella(fn() => umbrellapag_inspect_transaction('invalid/id'), 400);
$remoteState = 'REFUSED';
$before = count($updates);
$inspection = reply_umbrella(fn() => umbrellapag_inspect_transaction('existing-trx'), 200);
check_umbrella($inspection['data']['status'] === 'REFUSED' && str_contains($inspection['data']['reason'], 'TEST_PROVIDER_REFUSAL'), 'Read-only inspection dropped refusal detail');
check_umbrella(count($updates) === $before && (int)$pdo->query('SELECT COUNT(*) FROM orders')->fetchColumn() === 0, 'Inspection changed orders');
check_umbrella($requests[array_key_last($requests)][2] === 'GET', 'Inspection created a charge');
$remoteState = 'WAITING_PAYMENT';
$sellerResponse = ['data' => ['legalName' => 'Test Seller', 'blocked' => false, 'permissions' => ['isPixAvailable' => true]]];
check_umbrella(umbrellapag_verified_seller(200, $sellerResponse)['name'] === 'Test Seller', 'Valid seller rejected');
check_umbrella(umbrellapag_verified_seller(201, $sellerResponse)['name'] === 'Test Seller', 'Successful seller response rejected');
foreach ([401, 403, 429, 500] as $httpCode) {
    try { umbrellapag_verified_seller($httpCode, $sellerResponse); throw new LogicException('Failed HTTP response accepted'); }
    catch (LogicException $error) { throw $error; }
    catch (RuntimeException $expected) { check_umbrella(str_contains($expected->getMessage(), (string)$httpCode), 'Diagnostic did not identify HTTP failure'); }
}
foreach ([['blocked', true, 'bloqueada'], ['blocked', null, 'blocked=false'], ['permissions', ['isPixAvailable' => false], 'não está liberado'], ['permissions', [], 'isPixAvailable=true'], ['legalName', '', 'legalName']] as [$field, $value, $diagnostic]) {
    $invalid = $sellerResponse; $invalid['data'][$field] = $value;
    try { umbrellapag_verified_seller(200, $invalid); throw new LogicException('Invalid seller was allowed to activate'); }
    catch (LogicException $error) { throw $error; }
    catch (RuntimeException $expected) { check_umbrella(str_contains($expected->getMessage(), $diagnostic), 'Diagnostic did not identify seller failure'); }
}
check_umbrella(!umbrellapag_active($store) && !umbrellapag_active(null), 'Retired gateway must not activate Umbrella');
$publicStore = umbrellapag_store($store);
check_umbrella($publicStore['pagamento']['gateway'] === ['provedor' => 'UmbrellaPag', 'ativo' => false], 'Public config must expose only the current gateway without activating it');
reply_umbrella(fn() => create_gateway_payment(), 409);
$owner = false;
reply_umbrella(fn() => umbrellapag_admin_status(), 403);
reply_umbrella(fn() => umbrellapag_admin_connect(true), 403);
$owner = true; $config['umbrellapag_api_key'] = '';
reply_umbrella(fn() => umbrellapag_admin_connect(true), 422);
$config['umbrellapag_api_key'] = 'umbrella-test-only'; $sellerBlocked = true;
reply_umbrella(fn() => umbrellapag_admin_connect(true), 422);
$sellerBlocked = false; $pixEnabled = false;
reply_umbrella(fn() => umbrellapag_admin_connect(true), 422);
$pixEnabled = true;
reply_umbrella(fn() => umbrellapag_admin_connect(false), 200);
check_umbrella(json_decode($pdo->query('SELECT value FROM settings')->fetchColumn(), true)['pagamento']['gateway']['provedor'] === 'RetiredGateway', 'Read-only connection check switched the store');
reply_umbrella(fn() => umbrellapag_admin_connect(true), 200);
$store = json_decode($pdo->query('SELECT value FROM settings')->fetchColumn(), true);
check_umbrella(umbrellapag_active($store), 'Activation did not persist provider');
$posted = ['customer' => ['name' => 'Test Customer', 'email' => 'test@example.com', 'phone' => '11999999999', 'document' => ['number' => '52998224725']],
    'shipping' => ['street' => 'Test Road', 'number' => '10', 'neighborhood' => 'Centro', 'city' => 'City', 'state' => 'SP', 'zipCode' => '01001000'],
    'items' => [['id' => 'glasses', 'quantity' => 1]], 'amount' => 1];
$charge = reply_umbrella(fn() => create_gateway_payment(), 201);
check_umbrella($charge['provider'] === 'umbrellapag' && $charge['data']['amount'] === 12345 && $charge['data']['status'] === 'PENDING', 'Creation failed to normalize amount/provider/status');
$sent = $requests[array_key_last($requests)][3];
check_umbrella($sent['paymentMethod'] === 'PIX' && $sent['customer']['document']['type'] === 'CPF'
    && $sent['shipping']['address']['streetNumber'] === '10' && $sent['shipping']['fee'] === 0
    && $sent['customer']['address']['country'] === 'BR' && !isset($sent['shipping']['number'])
    && !isset($sent['externalRef']) && $sent['items'][0]['title'] === 'Glasses', 'Wrong Umbrella payload');
check_umbrella($pdo->query('SELECT payment_method FROM orders')->fetchColumn() === 'umbrellapag', 'Order provider was not recorded');
$reference = $pdo->query('SELECT external_ref FROM payment_transactions')->fetchColumn();
$_GET = ['ref' => $reference, 'token' => str_repeat('0', 64)];
$posted = ['objectId' => 'new-trx', 'data' => ['status' => 'paid']];
reply_umbrella(fn() => umbrellapag_webhook(), 401);
$_GET['token'] = umbrellapag_callback_token($reference, $config['app_secret']);
$before = count($updates);
reply_umbrella(fn() => umbrellapag_webhook(), 200);
check_umbrella(count($updates) === $before + 1 && $updates[array_key_last($updates)][1] === 'PENDING', 'Posted paid status was trusted');
$wrongAmount = true;
reply_umbrella(fn() => umbrellapag_webhook(), 503);
check_umbrella(count($updates) === $before + 1, 'Wrong amount updated payment');
$wrongAmount = false; $posted['objectId'] = 'other';
reply_umbrella(fn() => umbrellapag_webhook(), 400);
$posted['objectId'] = 'new-trx'; $remoteState = 'PAID';
reply_umbrella(fn() => umbrellapag_webhook(), 200);
check_umbrella($updates[array_key_last($updates)] === ['new-trx', 'PAID', true], 'Verified payment was not applied');
reply_umbrella(fn() => payment_status('new-trx'), 200);
$pdo->exec("INSERT INTO orders VALUES('old-order','legacy-trx','retired_gateway',500,NULL)");
$pdo->exec("INSERT INTO payment_transactions VALUES('legacy-trx',500,'legacy-ref',1)");
$before = count($requests);
reply_umbrella(fn() => payment_status('legacy-trx'), 410);
check_umbrella(count($requests) === $before, 'A retired payment must never contact a gateway');
reply_umbrella(fn() => payment_status('missing'), 404);
$valid = ['data' => ['id' => 'trx', 'amount' => 100, 'paymentMethod' => 'PIX', 'currency' => 'BRL', 'status' => 'PAID']];
foreach ([['id', 'other'], ['amount', '100'], ['currency', 'USD'], ['paymentMethod', 'credit_card'], ['status', 'UNKNOWN']] as [$field, $value]) {
    $invalid = $valid; $invalid['data'][$field] = $value;
    try { umbrellapag_confirmed_transaction($invalid, 'trx', 100); throw new LogicException('Invalid transaction accepted'); }
    catch (LogicException $error) { throw $error; } catch (RuntimeException $expected) {}
}
foreach (['WAITING_PAYMENT' => 'PENDING', 'PROCESSING' => 'PENDING', 'PAID' => 'PAID', 'REFUSED' => 'CANCELLED', 'CANCELED' => 'CANCELLED', 'REFUNDED' => 'REFUNDED', 'CHARGEDBACK' => 'REFUNDED'] as $inputState => $normalized) {
    $valid['data']['status'] = $inputState;
    check_umbrella(umbrellapag_confirmed_transaction($valid, 'trx', 100)['status'] === $normalized, 'Wrong status mapping');
}
$remoteState = 'WAITING_PAYMENT';
$posted = ['requestId' => '11111111-1111-4111-8111-111111111111', 'amount' => '1,00', 'acknowledgeRealCharge' => true,
    'customer' => ['name' => 'Test Payer', 'email' => 'test@example.com', 'phone' => '11999999999', 'document' => '52998224725']];
$test = reply_umbrella(fn() => gateway_test_create(), 201);
check_umbrella($test['data']['transactionId'] === 'test-trx', 'Admin test creation failed');
$before = count($requests);
reply_umbrella(fn() => gateway_test_create(), 200);
check_umbrella(count($requests) === $before, 'Retried request created a duplicate charge');
$remoteState = 'PAID';
$test = reply_umbrella(fn() => gateway_test_status('11111111-1111-4111-8111-111111111111'), 200);
check_umbrella($test['data']['status'] === 'PAID', 'Admin test status failed');
$testReference = $pdo->query('SELECT external_ref FROM gateway_test_charges')->fetchColumn();
$_GET = ['ref' => $testReference, 'token' => umbrellapag_callback_token($testReference, $config['app_secret'])];
$posted = ['objectId' => 'test-trx'];
reply_umbrella(fn() => gateway_test_webhook(), 200);
check_umbrella((int)$pdo->query('SELECT COUNT(*) FROM orders')->fetchColumn() === 2, 'Admin test created a product order');
$rejectCreation = true;
foreach (['0.99', '100.01', '-1', '1e2', '1.001'] as $invalidAmount) {
    try { gateway_test_amount($invalidAmount); throw new LogicException('Invalid test amount accepted'); }
    catch (InvalidArgumentException $expected) {}
}
try { gateway_test_document('11111111111'); throw new LogicException('Invalid payer document accepted'); }
catch (InvalidArgumentException $expected) {}
$noConsent = ['requestId' => '33333333-3333-4333-8333-333333333333', 'amount' => '1,00', 'acknowledgeRealCharge' => false];
try { gateway_test_input($noConsent); throw new LogicException('A test charge without consent was accepted'); }
catch (InvalidArgumentException $expected) {}
$before = count($requests);
$pdo->exec("INSERT INTO gateway_test_charges VALUES('44444444-4444-4444-8444-444444444444',1,'retired-trx','GT44444444444444444444444444444444',100,'PENDING','hash',NULL,1,1)");
reply_umbrella(fn() => gateway_test_status('44444444-4444-4444-8444-444444444444'), 404);
check_umbrella(count($requests) === $before, 'Retired admin test contacted the new gateway');
$posted = ['requestId' => '22222222-2222-4222-8222-222222222222', 'amount' => '1,00', 'acknowledgeRealCharge' => true,
    'customer' => ['name' => 'Test Payer', 'email' => 'test@example.com', 'phone' => '11999999999', 'document' => '52998224725']];
$failure = reply_umbrella(fn() => gateway_test_create(), 422);
check_umbrella(str_contains($failure['error'], 'HTTP 422') && str_contains($failure['error'], 'customer.address'), 'Test rejection does not identify the validation error');
check_umbrella(!str_contains($failure['error'], 'umbrella-test-only') && !str_contains($failure['error'], 'test@example.com') && !str_contains($failure['error'], 'Test Payer'), 'Test rejection leaked private values');
check_umbrella($pdo->query("SELECT status FROM gateway_test_charges WHERE request_id='22222222-2222-4222-8222-222222222222'")->fetchColumn() === 'FAILED', 'Rejected test was not marked failed');
echo "Umbrella Pix creation, activation, payload, webhook verification, retired gateway isolation and admin test checks passed.\n";
