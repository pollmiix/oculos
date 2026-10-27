<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/blackcat-gateway.php';
class GatewayReply extends RuntimeException {
    public function __construct(public int $status, public array $body) { parent::__construct('Test response'); }
}
$config = ['app_secret' => str_repeat('s', 40), 'blackcat_api_key' => 'test-only-key'];
$owner = true; $remoteStatus = 200; $remoteResponse = ['success' => true, 'data' => ['name' => 'Conta de teste']];
$dbCalls = 0; $updates = []; $posted = [];
function config_value(string $key): string { return $GLOBALS['config'][$key] ?? ''; }
function require_admin(bool $write = false, array $roles = []): array {
    if (!$GLOBALS['owner']) respond(403, ['error' => 'Denied']);
    return ['admin_id' => 1];
}
function respond(int $status, array $body): never { throw new GatewayReply($status, $body); }
function store_value(): array { return ['pagamento' => ['metodo' => 'pix']]; }
function rate_limited(string $bucket, int $limit, int $window): bool { return false; }
function json_body(int $limit): array { return $GLOBALS['posted']; }
function call_blackcat(string $path, string $method, string $key, ?array $payload = null, int $timeout = 25): array {
    if ($method !== 'GET' || $payload !== null || $key !== 'test-only-key') throw new RuntimeException('Unexpected gateway operation');
    return [$GLOBALS['remoteStatus'], $GLOBALS['remoteResponse']];
}
function db(): object {
    $GLOBALS['dbCalls']++;
    return new class {
        public function prepare(string $sql): object {
            return new class {
                public function execute(array $params): void {}
                public function fetch(): array { return ['transaction_id' => 'TRX-TEST', 'amount' => 16918]; }
            };
        }
    };
}
function update_payment(string $id, string $status, bool $byTransaction): bool {
    $GLOBALS['updates'][] = [$id, $status, $byTransaction]; return true;
}
function expect_reply(callable $action, int $status): array {
    try { $action(); } catch (GatewayReply $reply) {
        if ($reply->status !== $status) throw new RuntimeException('Unexpected response: ' . $reply->status);
        return $reply->body;
    }
    throw new RuntimeException('Missing response');
}
function check_gateway(bool $valid, string $message): void { if (!$valid) throw new RuntimeException($message); }
$ref = 'MN' . str_repeat('A', 24);
$token = blackcat_callback_token($ref, $config['app_secret']);
check_gateway(strlen($token) === 64 && $token !== blackcat_callback_token($ref, str_repeat('b', 40)), 'Callback tokens must depend on the secret');
$valid = ['success' => true, 'data' => ['transactionId' => 'TRX-TEST', 'amount' => 16918, 'status' => 'PAID']];
check_gateway(blackcat_confirmed_transaction($valid, 'TRX-TEST', 16918)['status'] === 'PAID', 'Valid status rejected');
foreach ([['transactionId', 'other'], ['amount', 16919], ['amount', '16918'], ['status', 'UNKNOWN']] as [$field, $value]) {
    $invalid = $valid; $invalid['data'][$field] = $value;
    try { blackcat_confirmed_transaction($invalid, 'TRX-TEST', 16918); throw new LogicException('Invalid confirmation accepted'); }
    catch (LogicException $error) { throw $error; } catch (RuntimeException $expected) {}
}
check_gateway(blackcat_check_connection()['name'] === 'Conta de teste', 'Seller verification failed');
$owner = false;
expect_reply(fn() => blackcat_admin_status(), 403);
expect_reply(fn() => blackcat_admin_connect(true), 403);
$owner = true; $config['blackcat_api_key'] = '';
expect_reply(fn() => blackcat_admin_connect(true), 422);
check_gateway($dbCalls === 0, 'Missing key must not activate or write a store');
$config['blackcat_api_key'] = 'test-only-key';
expect_reply(fn() => blackcat_admin_connect(false), 200);
$_GET = ['ref' => $ref, 'token' => str_repeat('0', 64)];
expect_reply(fn() => blackcat_webhook(), 401);
check_gateway($dbCalls === 0, 'Invalid webhook token must not access transactions');
$_GET['token'] = $token;
$posted = ['transactionId' => 'TRX-TEST', 'status' => 'PAID'];
$remoteResponse = $valid; $remoteResponse['data']['status'] = 'PENDING';
expect_reply(fn() => blackcat_webhook(), 200);
check_gateway($updates === [['TRX-TEST', 'PENDING', true]], 'A posted PAID must not override the actual gateway status');
$remoteResponse['data']['amount'] = 10;
expect_reply(fn() => blackcat_webhook(), 503);
check_gateway(count($updates) === 1, 'Mismatched amounts must not update an order');
$remoteResponse = $valid;
expect_reply(fn() => blackcat_webhook(), 200);
check_gateway($updates[1] === ['TRX-TEST', 'PAID', true], 'Verified payment was not applied');
echo "Gateway authentication, activation guards, callback and payment verification tests passed.\n";
