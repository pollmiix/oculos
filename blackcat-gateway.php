<?php
declare(strict_types=1);

function blackcat_callback_token(string $reference, string $secret): string
{
    if (strlen($secret) < 32) throw new RuntimeException('Configure APP_SECRET no servidor.');
    return hash_hmac('sha256', 'blackcat-postback:' . $reference, $secret);
}

function blackcat_confirmed_transaction(array $response, string $id, int $amount): array
{
    $data = $response['data'] ?? null;
    if (($response['success'] ?? true) !== true || !is_array($data)
        || ($data['transactionId'] ?? null) !== $id || ($data['amount'] ?? null) !== $amount
        || !in_array($data['status'] ?? '', ['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'], true)) {
        throw new RuntimeException('O gateway não confirmou a transação e o valor esperado.');
    }
    return $data;
}

function blackcat_check_connection(): array
{
    $key = config_value('blackcat_api_key');
    if ($key === '') throw new RuntimeException('Configure BLACKCAT_API_KEY nas variáveis de Production da Vercel e faça Redeploy.');
    [$status, $response] = call_blackcat('/sales/seller', 'GET', $key);
    $seller = $response['data'] ?? null;
    if ($status !== 200 || ($response['success'] ?? true) !== true || !is_array($seller)
        || (!is_string($seller['name'] ?? null) && !is_string($seller['legalName'] ?? null))) {
        throw new RuntimeException('Não foi possível validar a conta na BlackCat. Confira a chave privada e a liberação da API no gateway.');
    }
    return ['name' => (string)($seller['legalName'] ?? $seller['name'])];
}

function blackcat_admin_status(): never
{
    require_admin(false, ['owner']);
    $store = store_value() ?? [];
    respond(200, ['configured' => config_value('blackcat_api_key') !== '',
        'transportReady' => function_exists('curl_init'),
        'active' => ($store['pagamento']['metodo'] ?? '') === 'gateway']);
}

function blackcat_admin_connect(bool $activate): never
{
    $session = require_admin(true, ['owner']);
    if (rate_limited('gateway-connection-check', 6, 60)) respond(429, ['error' => 'Aguarde um minuto antes de verificar novamente.']);
    try { $seller = blackcat_check_connection(); }
    catch (RuntimeException $error) { respond(422, ['error' => $error->getMessage()]); }
    if ($activate) {
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $query = $pdo->prepare('SELECT `value` FROM settings WHERE `key`=? FOR UPDATE');
            $query->execute(['store']);
            $value = $query->fetchColumn();
            $store = $value === false ? null : json_decode((string)$value, true);
            if (!is_array($store) || empty($store['produtos'])) throw new RuntimeException('Publique o catálogo da loja antes de ativar o gateway.');
            $store['pagamento']['metodo'] = 'gateway';
            $store['pagamento']['gateway']['provedor'] = 'BlackCat';
            $update = $pdo->prepare('UPDATE settings SET `value`=?,updated_at=? WHERE `key`=?');
            $update->execute([json_encode(safe_store($store), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), time(), 'store']);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(422, ['error' => 'Não foi possível ativar o gateway. Confira se o catálogo foi publicado.']);
        }
        audit((int)$session['admin_id'], 'gateway_activated', 'store');
    }
    respond(200, ['success' => true, 'seller' => $seller, 'activated' => $activate]);
}

function blackcat_webhook(): never
{
    $reference = is_string($_GET['ref'] ?? null) ? $_GET['ref'] : '';
    $token = is_string($_GET['token'] ?? null) ? $_GET['token'] : '';
    if (!preg_match('/^MN[A-F0-9]{24}$/D', $reference) || strlen($token) !== 64
        || !hash_equals(blackcat_callback_token($reference, config_value('app_secret')), $token)) {
        respond(401, ['error' => 'Notificação não autorizada.']);
    }
    if (rate_limited('blackcat-webhook-' . $reference, 30, 60)) respond(429, ['error' => 'Aguarde antes de reenviar.']);
    $payload = json_body(65536);
    $query = db()->prepare('SELECT transaction_id,amount FROM payment_transactions WHERE external_ref=?');
    $query->execute([$reference]);
    $transaction = $query->fetch();
    // A creation callback may arrive before the order's database commit.
    if (!$transaction) respond(503, ['error' => 'Pedido ainda não disponível. Reenvie a notificação.']);
    if (($payload['transactionId'] ?? null) !== $transaction['transaction_id']) respond(400, ['error' => 'Transação inválida.']);
    try {
        [$status, $response] = call_blackcat('/sales/' . rawurlencode($transaction['transaction_id']) . '/status', 'GET', config_value('blackcat_api_key'), null, 7);
        if ($status !== 200) throw new RuntimeException('Falha ao consultar o pagamento.');
        // Never trust a posted PAID status: verify with the gateway using our key.
        $data = blackcat_confirmed_transaction($response, $transaction['transaction_id'], (int)$transaction['amount']);
        update_payment($transaction['transaction_id'], $data['status'], true);
    } catch (Throwable $error) {
        respond(503, ['error' => 'Confirmação temporariamente indisponível. Reenvie a notificação.']);
    }
    respond(200, ['success' => true]);
}
