<?php
declare(strict_types=1);

function blackcat_test_amount(mixed $value): int
{
    if (!is_string($value) || !preg_match('/^\d{1,3}(?:[.,]\d{1,2})?$/D', trim($value))) {
        throw new InvalidArgumentException('Informe um valor entre R$ 1,00 e R$ 100,00.');
    }
    $parts = preg_split('/[.,]/', trim($value));
    $cents = (int)$parts[0] * 100 + (int)str_pad($parts[1] ?? '', 2, '0');
    if ($cents < 100 || $cents > 10000) throw new InvalidArgumentException('O teste aceita valores de R$ 1,00 a R$ 100,00.');
    return $cents;
}

function blackcat_test_document(string $value): array
{
    $digits = preg_replace('/[.\-\/\s]/', '', $value);
    if (!preg_match('/^(?:\d{11}|\d{14})$/D', $digits) || preg_match('/^(\d)\1+$/D', $digits)) {
        throw new InvalidArgumentException('Informe um CPF ou CNPJ válido.');
    }
    $length = strlen($digits);
    for ($check = $length - 2; $check < $length; $check++) {
        $sum = 0;
        for ($i = 0; $i < $check; $i++) {
            $weight = $length === 11 ? $check + 1 - $i : (($check - 1 - $i) % 8) + 2;
            $sum += (int)$digits[$i] * $weight;
        }
        $expected = $sum % 11 < 2 ? 0 : 11 - $sum % 11;
        if ((int)$digits[$check] !== $expected) throw new InvalidArgumentException('Confira os dígitos do CPF ou CNPJ.');
    }
    return ['type' => $length === 11 ? 'cpf' : 'cnpj', 'number' => $digits];
}

function blackcat_test_input(array $input): array
{
    if (($input['acknowledgeRealCharge'] ?? null) !== true) throw new InvalidArgumentException('Confirme que entende que será criada uma cobrança real.');
    $id = $input['requestId'] ?? null;
    if (!is_string($id) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/Di', $id)) {
        throw new InvalidArgumentException('Identificador de teste inválido. Atualize a página.');
    }
    $customer = $input['customer'] ?? [];
    if (!is_array($customer)) throw new InvalidArgumentException('Preencha os dados do pagador.');
    $name = required_text($customer['name'] ?? null, 'nome completo', 120);
    $email = required_text($customer['email'] ?? null, 'e-mail', 254);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new InvalidArgumentException('Informe um e-mail válido.');
    $phone = preg_replace('/[+()\s\-]/', '', (string)($customer['phone'] ?? ''));
    if (!preg_match('/^\d{10,13}$/D', $phone)) throw new InvalidArgumentException('Informe o telefone com DDD.');
    return ['requestId' => strtolower($id), 'amount' => blackcat_test_amount($input['amount'] ?? null),
        'customer' => ['name' => $name, 'email' => $email, 'phone' => $phone,
            'document' => blackcat_test_document((string)($customer['document'] ?? ''))]];
}

function blackcat_test_find(string $id, int $adminId): ?array
{
    $query = db()->prepare('SELECT * FROM gateway_test_charges WHERE request_id=? AND admin_id=?');
    $query->execute([$id, $adminId]);
    return $query->fetch() ?: null;
}

function blackcat_test_reply(array $row, int $httpStatus = 200): never
{
    $payment = json_decode($row['payment_json'] ?? '', true) ?: [];
    respond($httpStatus, ['success' => true, 'testCharge' => true, 'requestId' => $row['request_id'],
        'data' => ['transactionId' => $row['transaction_id'], 'amount' => (int)$row['amount'], 'status' => $row['status'],
            'paymentData' => $payment['paymentData'] ?? [], 'invoiceUrl' => $payment['invoiceUrl'] ?? null]]);
}

function blackcat_test_create(): never
{
    $session = require_admin(true, ['owner']);
    $input = blackcat_test_input(json_body(16384));
    $key = config_value('blackcat_api_key');
    if ($key === '') respond(503, ['error' => 'Configure a chave privada na Vercel e faça Redeploy antes de testar.', 'noChargeCreated' => true]);
    $hash = hash_hmac('sha256', json_encode([$input['amount'], $input['customer']]), config_value('app_secret'));
    $id = $input['requestId'];
    $adminId = (int)$session['admin_id'];
    $previous = blackcat_test_find($id, $adminId);
    if ($previous) {
        if (!hash_equals($previous['payload_hash'], $hash)) respond(409, ['error' => 'Este teste já foi enviado com outros dados. Consulte a cobrança existente.']);
        blackcat_test_reply($previous);
    }
    if (rate_limited('gateway-test-create-' . $adminId, 3, 60)) respond(429, ['error' => 'Limite de três testes por minuto. Aguarde antes de gerar outro.']);
    $reference = 'GT' . strtoupper(str_replace('-', '', $id));
    $base = rtrim(config_value('public_base_url', 'https://vemariotica.online'), '/');
    if (parse_url($base, PHP_URL_SCHEME) !== 'https') throw new RuntimeException('Configure PUBLIC_BASE_URL com HTTPS.');
    $callback = $base . '/api/webhooks/blackcat-test?ref=' . rawurlencode($reference)
        . '&token=' . blackcat_callback_token($reference, config_value('app_secret'));
    // Reserve before contacting the gateway. Repeating this request ID cannot
    // create another charge, including after a timeout or a double click.
    try {
        $insert = db()->prepare("INSERT INTO gateway_test_charges(request_id,admin_id,external_ref,amount,status,payload_hash,created_at,updated_at) VALUES(?,?,?,?,'CREATING',?,?,?)");
        $insert->execute([$id, $adminId, $reference, $input['amount'], $hash, time(), time()]);
    } catch (PDOException $error) {
        if ($error->getCode() === '23000') respond(409, ['error' => 'Este teste já está sendo processado. Consulte o pagamento.', 'requestId' => $id, 'creationUncertain' => true]);
        throw $error;
    }
    $payload = ['amount' => $input['amount'], 'currency' => 'BRL', 'paymentMethod' => 'pix',
        'items' => [['title' => 'Teste de integração Pix - sem produto', 'unitPrice' => $input['amount'], 'quantity' => 1, 'tangible' => false]],
        'customer' => $input['customer'], 'externalRef' => $reference, 'pix' => ['expiresInDays' => 1],
        'metadata' => 'Teste administrativo. Sem pedido de produto ou movimentação de estoque.', 'postbackUrl' => $callback];
    try {
        [$status, $response] = call_blackcat('/sales/create-sale', 'POST', $key, $payload);
    } catch (RuntimeException) {
        db()->prepare("UPDATE gateway_test_charges SET status='UNKNOWN',updated_at=? WHERE request_id=? AND status='CREATING'")->execute([time(), $id]);
        respond(503, ['error' => 'A resposta do gateway não chegou. Consulte este teste antes de gerar outra cobrança.', 'requestId' => $id, 'creationUncertain' => true]);
    }
    if ($status >= 400 && $status < 500) {
        db()->prepare("UPDATE gateway_test_charges SET status='FAILED',updated_at=? WHERE request_id=? AND status='CREATING'")->execute([time(), $id]);
        respond(422, ['error' => 'A BlackCat recusou o teste. Confira os dados do pagador e a liberação da conta.', 'requestId' => $id, 'rejected' => true]);
    }
    $transaction = $response['data'] ?? [];
    $transactionId = is_string($transaction['transactionId'] ?? null) ? $transaction['transactionId'] : '';
    if ($transactionId !== '' && strlen($transactionId) <= 120) {
        db()->prepare('UPDATE gateway_test_charges SET transaction_id=? WHERE request_id=?')->execute([$transactionId, $id]);
    }
    try {
        if (!in_array($status, [200, 201], true) || $transactionId === '' || strlen($transactionId) > 120) throw new RuntimeException('Invalid creation response');
        $transaction = blackcat_confirmed_transaction($response, $transactionId, $input['amount']);
    } catch (RuntimeException) {
        db()->prepare("UPDATE gateway_test_charges SET status='UNKNOWN',updated_at=? WHERE request_id=? AND status='CREATING'")->execute([time(), $id]);
        respond(502, ['error' => 'Não foi possível confirmar o resultado da criação. Consulte o pagamento antes de tentar novamente.', 'requestId' => $id, 'creationUncertain' => true]);
    }
    $safePayment = ['paymentData' => [], 'invoiceUrl' => null];
    foreach (['qrCode', 'qrCodeBase64', 'copyPaste', 'expiresAt'] as $field) {
        $value = $transaction['paymentData'][$field] ?? null;
        if (is_string($value) && strlen($value) <= 1048576) $safePayment['paymentData'][$field] = $value;
    }
    $invoice = $transaction['invoiceUrl'] ?? null;
    if (is_string($invoice) && filter_var($invoice, FILTER_VALIDATE_URL) && parse_url($invoice, PHP_URL_SCHEME) === 'https') $safePayment['invoiceUrl'] = $invoice;
    db()->prepare("UPDATE gateway_test_charges SET status=CASE WHEN status IN ('PAID','REFUNDED') THEN status ELSE ? END,payment_json=?,updated_at=? WHERE request_id=?")
        ->execute([$transaction['status'], json_encode($safePayment, JSON_UNESCAPED_SLASHES), time(), $id]);
    audit($adminId, 'gateway_test_charge_created', 'gateway_test_charge', $id);
    blackcat_test_reply(blackcat_test_find($id, $adminId), 201);
}

function blackcat_test_update(array $row, string $state): void
{
    // These rows never enter orders, sales reports, product stock or analytics.
    $query = db()->prepare("UPDATE gateway_test_charges SET status=?,updated_at=? WHERE request_id=? AND (status NOT IN ('PAID','REFUNDED') OR (status='PAID' AND ?='REFUNDED'))");
    $query->execute([$state, time(), $row['request_id'], $state]);
}

function blackcat_test_status(string $id): never
{
    $session = require_admin(false, ['owner']);
    $row = blackcat_test_find($id, (int)$session['admin_id']);
    if (!$row) respond(404, ['error' => 'Teste não encontrado para esta conta.']);
    if (!$row['transaction_id']) blackcat_test_reply($row);
    if (rate_limited('gateway-test-status-' . (int)$session['admin_id'], 30, 60)) respond(429, ['error' => 'Aguarde antes de consultar novamente.']);
    $key = config_value('blackcat_api_key');
    if ($key === '') respond(503, ['error' => 'Configure a chave do gateway para consultar este teste.']);
    try {
        [$status, $response] = call_blackcat('/sales/' . rawurlencode($row['transaction_id']) . '/status', 'GET', $key);
        if ($status !== 200) throw new RuntimeException('Status unavailable');
        $data = blackcat_confirmed_transaction($response, $row['transaction_id'], (int)$row['amount']);
        blackcat_test_update($row, $data['status']);
    } catch (RuntimeException) { respond(502, ['error' => 'Não foi possível confirmar o pagamento no gateway. Tente consultar novamente.']); }
    blackcat_test_reply(blackcat_test_find($id, (int)$session['admin_id']));
}

function blackcat_test_webhook(): never
{
    $reference = is_string($_GET['ref'] ?? null) ? $_GET['ref'] : '';
    $token = is_string($_GET['token'] ?? null) ? $_GET['token'] : '';
    if (!preg_match('/^GT[A-F0-9]{32}$/D', $reference) || strlen($token) !== 64
        || !hash_equals(blackcat_callback_token($reference, config_value('app_secret')), $token)) respond(401, ['error' => 'Notificação não autorizada.']);
    if (rate_limited('gateway-test-webhook-' . $reference, 30, 60)) respond(429, ['error' => 'Aguarde para reenviar.']);
    $posted = json_body(65536);
    $query = db()->prepare('SELECT * FROM gateway_test_charges WHERE external_ref=?');
    $query->execute([$reference]);
    $row = $query->fetch();
    if (!$row) respond(503, ['error' => 'Teste ainda não disponível. Reenvie.']);
    // Recover a creation whose HTTP response timed out, using its signed reference.
    $id = $posted['transactionId'] ?? null;
    if (!is_string($id) || $id === '' || strlen($id) > 120 || ($row['transaction_id'] && $row['transaction_id'] !== $id)) respond(400, ['error' => 'Transação inválida.']);
    try {
        [$status, $response] = call_blackcat('/sales/' . rawurlencode($id) . '/status', 'GET', config_value('blackcat_api_key'), null, 7);
        if ($status !== 200) throw new RuntimeException('Status unavailable');
        $data = blackcat_confirmed_transaction($response, $id, (int)$row['amount']);
        if (!$row['transaction_id']) db()->prepare('UPDATE gateway_test_charges SET transaction_id=? WHERE request_id=? AND transaction_id IS NULL')->execute([$id, $row['request_id']]);
        blackcat_test_update($row, $data['status']);
    } catch (RuntimeException) { respond(503, ['error' => 'Não foi possível confirmar. Reenvie a notificação.']); }
    respond(200, ['success' => true]);
}
