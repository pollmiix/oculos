<?php
declare(strict_types=1);

// Only the server talks to the gateway. Never accept a gateway URL or key from a buyer.
const UMBRELLAPAG_API = 'https://api-gateway.umbrellapag.com/api';

function active_payment_provider(?array $store): string
{
    return strcasecmp((string)($store['pagamento']['gateway']['provedor'] ?? ''), 'UmbrellaPag') === 0
        ? 'umbrellapag' : 'blackcat';
}

function call_umbrellapag(string $path, string $method, string $key, ?array $payload = null, int $timeout = 25): array
{
    if ($key === '') throw new RuntimeException('Configure UMBRELLAPAG_API_KEY em Production na Vercel e faça Redeploy.');
    if (!function_exists('curl_init')) throw new RuntimeException('Ative a extensão cURL do PHP.');
    $handle = curl_init(UMBRELLAPAG_API . $path);
    $headers = ['x-api-key: ' . $key, 'User-Agent: UMBRELLAB2B/1.0', 'Accept: application/json'];
    if ($payload !== null) $headers[] = 'Content-Type: application/json';
    curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers, CURLOPT_CONNECTTIMEOUT => min(5, $timeout), CURLOPT_TIMEOUT => $timeout]);
    if ($payload !== null) curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $body = curl_exec($handle);
    $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    if ($body === false) throw new RuntimeException('Não foi possível contactar a UmbrellaPag.');
    $response = json_decode($body, true);
    if (!is_array($response)) throw new RuntimeException('A UmbrellaPag retornou uma resposta inválida.');
    return [$status, $response];
}

function umbrellapag_payload(array $sale): array
{
    $address = $sale['shipping'] ?? null;
    if (is_array($address)) {
        unset($address['name']);
        $address['streetNumber'] = $address['number'];
        unset($address['number']);
        $address['country'] = 'BR';
        $sale['customer']['address'] = $address;
        $sale['shipping'] = ['fee' => 0, 'address' => $address];
    }
    $reference = $sale['externalRef'];
    unset($sale['externalRef']);
    $sale['customer']['externalRef'] = $reference;
    $sale['customer']['document']['type'] = strtoupper($sale['customer']['document']['type']);
    $sale['paymentMethod'] = 'PIX';
    foreach ($sale['items'] as $index => &$item) {
        if (empty($item['externalRef'])) $item['externalRef'] = $reference . '-' . $index;
    }
    unset($item);
    $ip = function_exists('visitor_ip') ? visitor_ip() : ($_SERVER['REMOTE_ADDR'] ?? '');
    if (filter_var($ip, FILTER_VALIDATE_IP)) $sale['ip'] = $ip;
    $sale['installments'] = 1;
    $sale['traceable'] = true;
    $sale['metadata'] = json_encode(['orderRef' => $reference], JSON_THROW_ON_ERROR);
    return $sale;
}

function umbrellapag_rejection(int $status, array $response, array $privateValues = []): string
{
    $messages = [];
    foreach ([$response['message'] ?? null, is_array($response['error'] ?? null) ? ($response['error']['message'] ?? null) : ($response['error'] ?? null), $response['errors'] ?? null] as $detail) {
        if (is_string($detail)) $messages[] = $detail;
        elseif (is_array($detail)) array_walk_recursive($detail, static function ($value) use (&$messages): void {
            if (is_string($value) && count($messages) < 12) $messages[] = $value;
        });
    }
    $message = implode(' | ', array_unique($messages));
    // Only expose validation messages. Never return the original body or payer data.
    array_walk_recursive($privateValues, static function ($value) use (&$message): void {
        if (is_string($value) && strlen($value) >= 4) $message = str_ireplace($value, '[oculto]', $message);
    });
    $message = preg_replace('/https?:\/\/[^\s<>"\']+/i', '[endereço omitido]', $message);
    $message = preg_replace('/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i', '[e-mail omitido]', $message);
    $message = preg_replace('/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/i', '[identificador omitido]', $message);
    $message = preg_replace('/\b\d[\d.\-\/ ()]{6,}\d\b/', '[número omitido]', $message);
    $message = trim(preg_replace('/[\x00-\x1f\x7f]/', ' ', $message));
    if ($message === '') $message = 'A API não informou o motivo. Solicite ao suporte da UmbrellaPag o motivo da recusa de criação do Pix.';
    preg_match('/^.{0,800}/us', $message, $limited);
    return 'UmbrellaPag recusou a cobrança (HTTP ' . $status . '): ' . ($limited[0] ?? 'Resposta de validação inválida. Consulte o suporte do gateway.');
}

function umbrellapag_confirmed_transaction(array $response, string $id, int $amount): array
{
    $data = $response['data'] ?? null;
    if (!is_array($data) || !empty($response['error']) || ($data['id'] ?? null) !== $id
        || ($data['amount'] ?? null) !== $amount || ($data['currency'] ?? 'BRL') !== 'BRL'
        || strtoupper((string)($data['paymentMethod'] ?? '')) !== 'PIX') {
        throw new RuntimeException('A UmbrellaPag não confirmou a transação Pix e o valor esperado.');
    }
    $state = match ($data['status'] ?? '') {
        'WAITING_PAYMENT', 'PROCESSING', 'AUTHORIZED' => 'PENDING',
        'PAID' => 'PAID',
        'CANCELED', 'CANCELLED', 'REFUSED' => 'CANCELLED',
        'REFUNDED', 'CHARGEDBACK' => 'REFUNDED',
        default => throw new RuntimeException('A UmbrellaPag retornou um status desconhecido.'),
    };
    $pix = is_array($data['pix'] ?? null) ? $data['pix'] : [];
    // Some providers return an image in qrCode. Only an EMV payload is copyable.
    $copy = '';
    foreach ([$pix['qrcode'] ?? null, $pix['qrCode'] ?? null, $pix['copyPaste'] ?? null, $data['qrCode'] ?? null] as $value) {
        if (is_string($value) && str_starts_with(trim($value), '000201')) { $copy = trim($value); break; }
    }
    return ['transactionId' => $id, 'amount' => $amount, 'status' => $state,
        'paidAt' => $data['paidAt'] ?? null, 'invoiceUrl' => null,
        'paymentData' => ['copyPaste' => $copy, 'qrCode' => $copy,
            'qrCodeBase64' => null, 'expiresAt' => $pix['expirationDate'] ?? $pix['expiresAt'] ?? null]];
}

function umbrellapag_callback_token(string $reference, string $secret): string
{
    if (strlen($secret) < 32) throw new RuntimeException('Configure APP_SECRET no servidor.');
    return hash_hmac('sha256', 'umbrellapag-postback:' . $reference, $secret);
}

function umbrellapag_check_connection(): array
{
    [$status, $response] = call_umbrellapag('/user/sellers', 'GET', config_value('umbrellapag_api_key'));
    return umbrellapag_verified_seller($status, $response);
}

function umbrellapag_verified_seller(int $status, array $response): array
{
    // Explain the failure without exposing the response, account documents or key.
    if ($status === 401) throw new RuntimeException('UmbrellaPag: chave de API não aceita (HTTP 401). Confira UMBRELLAPAG_API_KEY em Production e faça Redeploy após corrigir.');
    if ($status === 403) throw new RuntimeException('UmbrellaPag: acesso à consulta da conta negado (HTTP 403). Peça ao suporte a liberação desta chave para consultar a empresa e receber Pix.');
    if ($status === 429) throw new RuntimeException('UmbrellaPag: limite de consultas atingido (HTTP 429). Aguarde um minuto e tente novamente.');
    if (!in_array($status, [200, 201], true)) throw new RuntimeException('UmbrellaPag: falha ao consultar a empresa (HTTP ' . $status . '). Informe este código ao suporte da UmbrellaPag.');
    $seller = $response['data'] ?? null;
    if (!is_array($seller) || !empty($response['error'])) throw new RuntimeException('UmbrellaPag: a consulta não retornou os dados da empresa no formato esperado. Informe ao suporte que a consulta /api/user/sellers não retornou data da empresa.');
    if (($seller['blocked'] ?? null) === true) throw new RuntimeException('UmbrellaPag: a API informou que a conta está bloqueada. Solicite a liberação ao suporte do gateway.');
    if (($seller['permissions']['isPixAvailable'] ?? null) === false) throw new RuntimeException('UmbrellaPag: a API informou que Pix não está liberado para esta conta. Solicite a habilitação ao suporte do gateway.');
    if (!is_string($seller['legalName'] ?? null) || trim($seller['legalName']) === '') throw new RuntimeException('UmbrellaPag: a resposta da empresa não informou legalName. Solicite ao suporte a confirmação do formato de /api/user/sellers.');
    if (($seller['blocked'] ?? null) !== false) throw new RuntimeException('UmbrellaPag: a resposta da empresa não confirmou blocked=false. A ativação depende dessa confirmação pelo gateway.');
    if (($seller['permissions']['isPixAvailable'] ?? null) !== true) throw new RuntimeException('UmbrellaPag: a resposta da empresa não confirmou permissions.isPixAvailable=true. Solicite ao suporte a confirmação da liberação do Pix pela API.');
    return ['name' => $seller['legalName']];
}

function umbrellapag_admin_status(): never
{
    require_admin(false, ['owner']);
    $store = store_value();
    respond(200, ['configured' => config_value('umbrellapag_api_key') !== '',
        'transportReady' => function_exists('curl_init'), 'provider' => 'UmbrellaPag',
        'active' => ($store['pagamento']['metodo'] ?? '') === 'gateway' && active_payment_provider($store) === 'umbrellapag']);
}

function umbrellapag_admin_connect(bool $activate): never
{
    $session = require_admin(true, ['owner']);
    if (rate_limited('gateway-connection-check', 6, 60)) respond(429, ['error' => 'Aguarde um minuto antes de verificar novamente.']);
    try {
        // Validate callback configuration before enabling new checkouts.
        umbrellapag_callback_token('configuration-check', config_value('app_secret'));
        $base = config_value('public_base_url', 'https://vemariotica.online');
        if (parse_url($base, PHP_URL_SCHEME) !== 'https') throw new RuntimeException('Configure PUBLIC_BASE_URL com HTTPS.');
        $seller = umbrellapag_check_connection();
    } catch (RuntimeException $error) { respond(422, ['error' => $error->getMessage()]); }
    if ($activate) {
        $pdo = db();
        $pdo->beginTransaction();
        try {
            $query = $pdo->prepare('SELECT `value` FROM settings WHERE `key`=? FOR UPDATE');
            $query->execute(['store']);
            $store = json_decode((string)$query->fetchColumn(), true);
            if (!is_array($store) || empty($store['produtos'])) throw new RuntimeException('Publique o catálogo antes de ativar.');
            $store['pagamento']['metodo'] = 'gateway';
            $store['pagamento']['gateway']['provedor'] = 'UmbrellaPag';
            $pdo->prepare('UPDATE settings SET `value`=?,updated_at=? WHERE `key`=?')
                ->execute([json_encode(safe_store($store), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), time(), 'store']);
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(422, ['error' => 'Não foi possível ativar. Confira se o catálogo foi publicado.']);
        }
        audit((int)$session['admin_id'], 'umbrellapag_activated', 'store');
    }
    respond(200, ['success' => true, 'seller' => $seller, 'activated' => $activate]);
}

function umbrellapag_webhook(): never
{
    $reference = is_string($_GET['ref'] ?? null) ? $_GET['ref'] : '';
    $token = is_string($_GET['token'] ?? null) ? $_GET['token'] : '';
    if (!preg_match('/^MN[A-F0-9]{24}$/D', $reference) || strlen($token) !== 64
        || !hash_equals(umbrellapag_callback_token($reference, config_value('app_secret')), $token)) respond(401, ['error' => 'Notificação não autorizada.']);
    if (rate_limited('umbrellapag-webhook-' . $reference, 30, 60)) respond(429, ['error' => 'Aguarde para reenviar.']);
    $payload = json_body(65536);
    $query = db()->prepare("SELECT p.transaction_id,p.amount FROM payment_transactions p JOIN orders o ON o.transaction_id=p.transaction_id WHERE p.external_ref=? AND o.payment_method='umbrellapag'");
    $query->execute([$reference]);
    $transaction = $query->fetch();
    if (!$transaction) respond(503, ['error' => 'Pedido ainda não disponível. Reenvie a notificação.']);
    if (($payload['objectId'] ?? null) !== $transaction['transaction_id']) respond(400, ['error' => 'Transação inválida.']);
    try {
        [$status, $response] = call_umbrellapag('/user/transactions/' . rawurlencode($transaction['transaction_id']), 'GET', config_value('umbrellapag_api_key'), null, 7);
        if ($status !== 200) throw new RuntimeException('Falha na consulta.');
        // Never confirm payment using the posted status.
        $data = umbrellapag_confirmed_transaction($response, $transaction['transaction_id'], (int)$transaction['amount']);
        update_payment($transaction['transaction_id'], $data['status'], true);
    } catch (Throwable $error) { respond(503, ['error' => 'Confirmação temporariamente indisponível. Reenvie a notificação.']); }
    respond(200, ['success' => true]);
}
