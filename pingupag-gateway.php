<?php
declare(strict_types=1);

function pingu_active(?array $store): bool {
    return ($store['pagamento']['metodo'] ?? '') === 'gateway'
        && strcasecmp((string)($store['pagamento']['gateway']['provedor'] ?? ''), 'PinguPag') === 0
        && ($store['pagamento']['gateway']['ativo'] ?? true) === true;
}
function pingu_call(string $path, string $method, ?array $payload = null): array {
    $key = config_value('pingupag_api_key');
    if ($key === '' || !function_exists('curl_init')) throw new RuntimeException('Gateway indisponivel.');
    $ch = curl_init('https://pagamento-processador.org.ua/gateway/v1/' . $path);
    $headers = ['X-API-Key: ' . $key, 'Accept: application/json'];
    if ($payload !== null) $headers[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method, CURLOPT_HTTPHEADER => $headers, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 25, CURLOPT_FOLLOWLOCATION => false]);
    if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    $body = curl_exec($ch); $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE); curl_close($ch);
    $data = is_string($body) ? json_decode($body, true) : null;
    if (!is_array($data)) throw new RuntimeException('Resposta invalida do gateway.');
    return [$status, $data];
}
function pingu_verify(string $id, string $reference, int $amount): string {
    [$http, $data] = pingu_call('query?action=get_transaction&id=' . rawurlencode($id), 'GET');
    if ($http !== 200 || (string)($data['id'] ?? '') !== $id || (string)($data['external_id'] ?? '') !== $reference || (int)($data['amount'] ?? -1) !== $amount) throw new RuntimeException('Transacao nao confirmada.');
    return match (strtolower((string)($data['status'] ?? ''))) {
        'approved' => 'PAID', 'pending' => 'PENDING', 'refunded' => 'REFUNDED', 'cancelled', 'canceled' => 'CANCELLED',
        default => throw new RuntimeException('Status desconhecido.')
    };
}
function pingu_admin_status(): never {
    require_admin(false, ['owner']);
    respond(200, ['configured' => config_value('pingupag_api_key') !== '', 'transportReady' => function_exists('curl_init'), 'active' => pingu_active(store_value())]);
}
function pingu_admin_connect(bool $activate): never {
    $session = require_admin(true, ['owner']);
    if (rate_limited('pingu-connection-check', 6, 60)) respond(429, ['error' => 'Aguarde antes de tentar novamente.']);
    try {
        [$http, $seller] = pingu_call('seller', 'GET');
        if ($http !== 200 || !is_string($seller['name'] ?? null)) throw new RuntimeException('Conta nao confirmada.');
    } catch (Throwable $e) { respond(422, ['error' => 'Nao foi possivel validar a PinguPag. Confira PINGUPAG_API_KEY no servidor.']); }
    if ($activate) {
        $pdo = db(); $pdo->beginTransaction();
        try {
            $query = $pdo->prepare('SELECT `value` FROM settings WHERE `key`=? FOR UPDATE'); $query->execute(['store']);
            $store = json_decode((string)$query->fetchColumn(), true);
            if (!is_array($store) || empty($store['produtos'])) throw new RuntimeException('Catalogo ausente.');
            $store['pagamento']['metodo'] = 'gateway'; $store['pagamento']['gateway'] = ['provedor' => 'PinguPag', 'ativo' => true];
            $query = $pdo->prepare('UPDATE settings SET `value`=?,updated_at=? WHERE `key`=?');
            $query->execute([json_encode(safe_store($store), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), time(), 'store']); $pdo->commit();
        } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack(); respond(422, ['error' => 'Publique o catalogo antes de ativar o gateway.']); }
        audit((int)$session['admin_id'], 'gateway_activated', 'store');
    }
    respond(200, ['success' => true, 'seller' => ['name' => $seller['name']], 'activated' => $activate]);
}
function pingu_payment_status(string $id): never {
    if (rate_limited('payment-status', 60, 60)) respond(429, ['error' => 'Aguarde antes de consultar novamente.']);
    $q = db()->prepare("SELECT p.amount,p.external_ref FROM payment_transactions p JOIN orders o ON o.transaction_id=p.transaction_id WHERE p.transaction_id=? AND o.payment_method='pingupag'");
    $q->execute([$id]); $row = $q->fetch();
    if (!$row) respond(404, ['error' => 'Pagamento nao encontrado.']);
    try { $state = pingu_verify($id, $row['external_ref'], (int)$row['amount']); }
    catch (Throwable $e) { respond(502, ['error' => 'Nao foi possivel confirmar o pagamento na PinguPag.']); }
    update_payment($id, $state, true);
    respond(200, ['success' => true, 'data' => ['transactionId' => $id, 'status' => $state, 'amount' => (int)$row['amount']]]);
}
function pingu_webhook(): never {
    $ref = (string)($_GET['ref'] ?? ''); $token = (string)($_GET['token'] ?? '');
    if (!preg_match('/^MN[A-F0-9]{24}$/D', $ref) || strlen($token) !== 64 || !hash_equals(blackcat_callback_token($ref, config_value('app_secret')), $token)) respond(401, ['error' => 'Notificacao nao autorizada.']);
    if (rate_limited('pingu-webhook-' . $ref, 30, 60)) respond(429, ['error' => 'Aguarde antes de reenviar.']);
    $payload = json_body(65536);
    $q = db()->prepare("SELECT p.transaction_id,p.amount FROM payment_transactions p JOIN orders o ON o.transaction_id=p.transaction_id WHERE p.external_ref=? AND o.payment_method='pingupag'");
    $q->execute([$ref]); $row = $q->fetch();
    if (!$row) respond(503, ['error' => 'Pedido ainda nao disponivel.']);
    if ((string)($payload['external_id'] ?? $payload['store_reference'] ?? '') !== $ref) respond(400, ['error' => 'Referencia invalida.']);
    try { $state = pingu_verify((string)$row['transaction_id'], $ref, (int)$row['amount']); update_payment((string)$row['transaction_id'], $state, true); }
    catch (Throwable $e) { respond(503, ['error' => 'Confirmacao indisponivel.']); }
    respond(200, ['success' => true]);
}
