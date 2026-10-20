<?php
declare(strict_types=1);

// Keep diagnostics in server logs so warnings cannot corrupt JSON responses.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

require_once __DIR__ . '/store-config.php';

const SESSION_SECONDS = 28800;
const MAX_BODY_SIZE = 8388608;
const BLACKCAT_API = 'https://api.blackcatoficial.com/api';

function respond(int $status, array $value, array $headers = []): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    foreach ($headers as $name => $valueHeader) {
        header($name . ': ' . $valueHeader);
    }
    echo json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function db(): PDO
{
    static $connection = null;
    if ($connection instanceof PDO) {
        return $connection;
    }
    $config = store_config();
    $missing = [];
    foreach (['db_host' => 'DB_HOST', 'db_name' => 'DB_NAME', 'db_user' => 'DB_USER'] as $key => $variable) {
        if (trim((string)($config[$key] ?? '')) === '') {
            $missing[] = $variable;
        }
    }
    if (!array_key_exists('db_password', $config)) {
        $missing[] = 'DB_PASSWORD';
    }
    if ($missing !== []) {
        respond(503, ['error' => 'Configure o MySQL nas variáveis da hospedagem ou em config.local.php. Faltam: ' . implode(', ', $missing) . '.']);
    }
    if (strlen(trim((string)($config['app_secret'] ?? ''))) < 32) {
        respond(503, ['error' => 'Configure APP_SECRET (ou app_secret) com pelo menos 32 caracteres aleatórios na hospedagem.']);
    }
    $port = filter_var($config['db_port'] ?? 3306, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 65535]]);
    if ($port === false || strpbrk((string)$config['db_host'] . (string)$config['db_name'], ";\r\n") !== false) {
        respond(503, ['error' => 'Confira o host, a porta e o nome do banco MySQL na hospedagem.']);
    }
    $databaseConnected = false;
    try {
        $options = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_TIMEOUT => 10];
        if (!empty($config['db_ssl_ca'])) {
            $sslCaOption = class_exists('Pdo\\Mysql') ? \Pdo\Mysql::ATTR_SSL_CA : PDO::MYSQL_ATTR_SSL_CA;
            $sslVerifyOption = class_exists('Pdo\\Mysql') ? \Pdo\Mysql::ATTR_SSL_VERIFY_SERVER_CERT : PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT;
            $options[$sslCaOption] = (string)$config['db_ssl_ca'];
            $options[$sslVerifyOption] = true;
        }
        $connection = new PDO(
            'mysql:host=' . $config['db_host'] . ';port=' . $port . ';dbname=' . $config['db_name'] . ';charset=utf8mb4',
            $config['db_user'],
            $config['db_password'],
            $options
        );
        $databaseConnected = true;
        initialize_database($connection, $config);
    } catch (PDOException $error) {
        error_log('Store API database initialization failed: ' . $error->getMessage());
        $driverCode = (int)($error->errorInfo[1] ?? 0);
        $message = match ($driverCode) {
            1045 => 'O MySQL recusou o usuário ou a senha. Confira DB_USER e DB_PASSWORD na Vercel e copie a senha atual da Aiven.',
            1049 => 'O banco informado em DB_NAME não existe nesse servidor MySQL.',
            2026 => 'Não foi possível validar a conexão TLS do MySQL. Confira o certificado CA configurado.',
            2002, 2003, 2005 => 'O servidor MySQL não está acessível. Confira DB_HOST, DB_PORT e as regras de rede do banco.',
            default => 'Não foi possível inicializar o MySQL. Confira as configurações e permissões do banco na hospedagem.',
        };
        respond(503, ['error' => $message, 'configurationCode' => 'MYSQL_' . $driverCode,
            'configurationStage' => $databaseConnected ? 'initialization' : 'connection']);
    } catch (Throwable $error) {
        error_log('Store API database initialization failed: ' . $error->getMessage());
        respond(503, ['error' => 'Não foi possível conectar ao banco MySQL. Confira as configurações da hospedagem.']);
    }
    return $connection;
}

function initialize_database(PDO $pdo, array $config): void
{
    $schema = [
        "CREATE TABLE IF NOT EXISTS settings (`key` VARCHAR(80) PRIMARY KEY, `value` LONGTEXT NOT NULL, updated_at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS admins (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'owner', active TINYINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) PRIMARY KEY, admin_id BIGINT UNSIGNED NOT NULL, csrf_token CHAR(64) NOT NULL, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL, INDEX idx_sessions_admin (admin_id), CONSTRAINT fk_sessions_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS orders (id VARCHAR(100) PRIMARY KEY, transaction_id VARCHAR(120) NULL UNIQUE, analytics_session_id CHAR(36) NULL, created_at BIGINT NOT NULL, status VARCHAR(40) NOT NULL, payment_status VARCHAR(30) NOT NULL, payment_method VARCHAR(30) NOT NULL, total_cents BIGINT NOT NULL, customer_json LONGTEXT NOT NULL, items_json LONGTEXT NOT NULL, pix_payload LONGTEXT NULL, INDEX idx_orders_created (created_at), INDEX idx_orders_payment (payment_status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS events (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, event_name VARCHAR(40) NOT NULL, happened_at BIGINT NOT NULL, session_id CHAR(36) NOT NULL, page_path VARCHAR(240) NOT NULL, product_id VARCHAR(120) NULL, source VARCHAR(180) NULL, device VARCHAR(30) NULL, browser VARCHAR(30) NULL, INDEX idx_events_date (happened_at), INDEX idx_events_session (session_id), INDEX idx_events_name (event_name)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS admin_audit (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, admin_id BIGINT UNSIGNED NOT NULL, action VARCHAR(80) NOT NULL, entity VARCHAR(80) NOT NULL, entity_id VARCHAR(120) NULL, happened_at BIGINT NOT NULL, INDEX idx_audit_admin (admin_id), CONSTRAINT fk_audit_admin FOREIGN KEY (admin_id) REFERENCES admins(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS payment_transactions (transaction_id VARCHAR(120) PRIMARY KEY, amount BIGINT NOT NULL, external_ref VARCHAR(120) NOT NULL, created_at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS api_rate_limits (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, bucket_key CHAR(64) NOT NULL, happened_at BIGINT NOT NULL, INDEX idx_rate_bucket (bucket_key, happened_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    ];
    foreach ($schema as $statement) {
        $pdo->exec($statement);
    }
    if (!$pdo->query("SHOW COLUMNS FROM orders LIKE 'pix_payload'")->fetch()) {
        $pdo->exec('ALTER TABLE orders ADD pix_payload LONGTEXT NULL');
    }
    $count = (int)$pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn();
    if ($count === 0 && !empty($config['admin_password'])) {
        if (strlen((string)$config['admin_password']) < 12) {
            respond(503, ['error' => 'Configure ADMIN_PASSWORD com pelo menos 12 caracteres para criar a conta do painel.']);
        }
        $username = trim((string)($config['admin_username'] ?? 'admin'));
        if (!preg_match('/^[A-Za-z0-9._-]{3,50}$/', $username)) {
            respond(503, ['error' => 'Configure ADMIN_USERNAME com 3 a 50 letras, números, pontos, hífens ou sublinhados.']);
        }
        $insert = $pdo->prepare('INSERT INTO admins(username,password_hash,role,created_at) VALUES(?,?,?,?)');
        $insert->execute([$username, password_hash((string)$config['admin_password'], PASSWORD_DEFAULT), 'owner', time()]);
    }
    $retention = max(30, min(365, (int)($config['analytics_retention_days'] ?? 90)));
    $delete = $pdo->prepare('DELETE FROM events WHERE happened_at < ?');
    $delete->execute([time() - $retention * 86400]);
}

function config_value(string $key, string $default = ''): string
{
    $config = store_config();
    return trim((string)($config[$key] ?? $default));
}

function json_body(int $limit = MAX_BODY_SIZE): array
{
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length < 1 || $length > $limit) {
        throw new InvalidArgumentException('A solicitação está vazia ou excede o limite permitido.');
    }
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    $value = json_decode($raw ?: '', true);
    if (!is_array($value)) {
        throw new InvalidArgumentException('Envie os dados em formato JSON válido.');
    }
    return $value;
}

function required_text(mixed $value, string $label, int $maximum = 200): string
{
    $text = is_string($value) ? trim($value) : '';
    $length = preg_match_all('/./us', $text, $matches);
    if (!is_string($value) || $text === '' || $length === false || $length > $maximum) {
        throw new InvalidArgumentException("Confira o campo {$label}.");
    }
    return $text;
}

function rate_limited(string $bucket, int $limit, int $window): bool
{
    $secret = config_value('app_secret');
    if (strlen($secret) < 32) {
        throw new RuntimeException('Configure app_secret com pelo menos 32 caracteres aleatórios.');
    }
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $key = hash_hmac('sha256', $bucket . '|' . $ip, $secret);
    $pdo = db();
    $remove = $pdo->prepare('DELETE FROM api_rate_limits WHERE happened_at < ?');
    $remove->execute([time() - max($window, 3600)]);
    $count = $pdo->prepare('SELECT COUNT(*) FROM api_rate_limits WHERE bucket_key=? AND happened_at>=?');
    $count->execute([$key, time() - $window]);
    if ((int)$count->fetchColumn() >= $limit) {
        return true;
    }
    $insert = $pdo->prepare('INSERT INTO api_rate_limits(bucket_key,happened_at) VALUES(?,?)');
    $insert->execute([$key, time()]);
    return false;
}

function store_value(): ?array
{
    $query = db()->prepare('SELECT `value` FROM settings WHERE `key`=?');
    $query->execute(['store']);
    $value = $query->fetchColumn();
    if ($value === false) {
        return null;
    }
    $store = json_decode((string)$value, true);
    return is_array($store) ? $store : null;
}

function send_merchant_feed(): never
{
    $store = store_value();
    if ($store === null) {
        respond(503, ['error' => 'O catálogo ainda não foi sincronizado com o servidor.']);
    }
    $baseUrl = rtrim(config_value('public_base_url', 'https://vemariotica.wuaze.com'), '/');
    if (!filter_var($baseUrl, FILTER_VALIDATE_URL) || parse_url($baseUrl, PHP_URL_SCHEME) !== 'https'
        || parse_url($baseUrl, PHP_URL_USER) !== null || parse_url($baseUrl, PHP_URL_QUERY) !== null
        || parse_url($baseUrl, PHP_URL_FRAGMENT) !== null) {
        respond(503, ['error' => 'Configure PUBLIC_BASE_URL com o endereço HTTPS público da loja.']);
    }
    $xml = static fn(string $value): string => htmlspecialchars($value, ENT_XML1 | ENT_COMPAT, 'UTF-8');
    header('Content-Type: application/xml; charset=utf-8');
    header('Cache-Control: public, max-age=300');
    header('X-Content-Type-Options: nosniff');
    echo '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>';
    echo '<title>' . $xml((string)($store['loja']['nome'] ?? 'Vemari Ótica')) . '</title>';
    echo '<link>' . $xml($baseUrl) . '</link>';
    echo '<description>Catálogo de produtos Vemari Ótica</description>';
    foreach (($store['produtos'] ?? []) as $product) {
        if (!is_array($product)) {
            continue;
        }
        $id = trim((string)($product['id'] ?? ''));
        $title = trim((string)($product['nome'] ?? ''));
        $description = trim((string)($product['descricao'] ?? $title));
        $image = trim((string)($product['imagem'] ?? ''));
        $additionalImages = is_array($product['imagens'] ?? null) ? $product['imagens'] : [];
        try {
            $priceCents = pix_price_cents($product);
        } catch (InvalidArgumentException) {
            continue;
        }
        if ($id === '' || $title === '' || $image === '' || $priceCents < 1) {
            continue;
        }
        if (str_starts_with($image, '/')) {
            $image = $baseUrl . $image;
        }
        if (!filter_var($image, FILTER_VALIDATE_URL) || strtolower((string)parse_url($image, PHP_URL_SCHEME)) !== 'https') {
            continue;
        }
        $link = $baseUrl . '/produto.html?id=' . rawurlencode($id);
        $stock = filter_var($product['estoque'] ?? 0, FILTER_VALIDATE_INT);
        $availability = $stock !== false && $stock > 0 ? 'in_stock' : 'out_of_stock';
        $brand = trim((string)($product['marca'] ?? $product['brand'] ?? ''));
        echo '<item>';
        echo '<g:id>' . $xml($id) . '</g:id>';
        echo '<g:title>' . $xml($title) . '</g:title>';
        echo '<g:description>' . $xml($description !== '' ? $description : $title) . '</g:description>';
        echo '<g:link>' . $xml($link) . '</g:link>';
        echo '<g:image_link>' . $xml($image) . '</g:image_link>';
        $seenImages = [$image => true];
        $additionalImageCount = 0;
        foreach ($additionalImages as $additionalImage) {
            if (!is_string($additionalImage)) {
                continue;
            }
            $additionalImage = trim($additionalImage);
            if ($additionalImage === '') {
                continue;
            }
            if (str_starts_with($additionalImage, '/')) {
                $additionalImage = $baseUrl . $additionalImage;
            }
            if (isset($seenImages[$additionalImage])
                || !filter_var($additionalImage, FILTER_VALIDATE_URL)
                || strtolower((string)parse_url($additionalImage, PHP_URL_SCHEME)) !== 'https') {
                continue;
            }
            echo '<g:additional_image_link>' . $xml($additionalImage) . '</g:additional_image_link>';
            $seenImages[$additionalImage] = true;
            $additionalImageCount++;
            if ($additionalImageCount >= 10) {
                break;
            }
        }
        echo '<g:availability>' . $availability . '</g:availability>';
        echo '<g:price>' . number_format($priceCents / 100, 2, '.', '') . ' BRL</g:price>';
        echo '<g:condition>new</g:condition>';
        if ($brand !== '') {
            echo '<g:brand>' . $xml($brand) . '</g:brand>';
        } else {
            echo '<g:identifier_exists>false</g:identifier_exists>';
        }
        if (!empty($product['sku'])) {
            echo '<g:mpn>' . $xml((string)$product['sku']) . '</g:mpn>';
        }
        echo '</item>';
    }
    echo '</channel></rss>';
    exit;
}

function safe_store(array $store): array
{
    unset($store['senhaAdmin']);
    if (isset($store['pagamento']['gateway']) && is_array($store['pagamento']['gateway'])) {
        foreach (array_keys($store['pagamento']['gateway']) as $key) {
            $normalized = str_replace('_', '', strtolower((string)$key));
            foreach (['private', 'privad', 'secret', 'segred', 'token', 'apikey', 'chaveapi'] as $word) {
                if (str_contains($normalized, $word)) {
                    unset($store['pagamento']['gateway'][$key]);
                    break;
                }
            }
        }
    }
    return $store;
}

function current_session(): ?array
{
    $token = (string)($_COOKIE['mn_admin'] ?? '');
    if ($token === '') {
        return null;
    }
    $query = db()->prepare('SELECT s.*,a.username,a.role,a.active FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=?');
    $query->execute([hash('sha256', $token)]);
    $row = $query->fetch();
    if (!$row || (int)$row['expires_at'] <= time() || !(int)$row['active']) {
        $delete = db()->prepare('DELETE FROM sessions WHERE token_hash=?');
        $delete->execute([hash('sha256', $token)]);
        return null;
    }
    return $row;
}

function require_admin(bool $write = false, array $roles = []): array
{
    $session = current_session();
    if (!$session) {
        respond(401, ['error' => 'Entre no painel administrativo para continuar.']);
    }
    if ($roles && !in_array($session['role'], $roles, true)) {
        respond(403, ['error' => 'Sua conta não tem permissão para esta ação.']);
    }
    if ($write && !hash_equals((string)$session['csrf_token'], (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        respond(403, ['error' => 'A sessão expirou. Atualize o painel e tente novamente.']);
    }
    return $session;
}

function audit(int $adminId, string $action, string $entity, string|int|null $entityId = null): void
{
    $query = db()->prepare('INSERT INTO admin_audit(admin_id,action,entity,entity_id,happened_at) VALUES(?,?,?,?,?)');
    $query->execute([$adminId, substr($action, 0, 80), substr($entity, 0, 80), $entityId === null ? null : substr((string)$entityId, 0, 120), time()]);
}

function set_admin_cookie(string $token, bool $expire = false): void
{
    setcookie('mn_admin', $token, [
        'expires' => $expire ? time() - 3600 : time() + SESSION_SECONDS,
        'path' => '/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'),
        'httponly' => true,
        'samesite' => 'Strict'
    ]);
}

function analytics_session(?string $id): ?string
{
    if (!$id || !preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id)) {
        return null;
    }
    $query = db()->prepare('SELECT 1 FROM events WHERE session_id=? LIMIT 1');
    $query->execute([$id]);
    return $query->fetchColumn() ? strtolower($id) : null;
}

function money_cents(mixed $value): int
{
    if (!is_numeric($value) || !is_finite((float)$value) || (float)$value <= 0) {
        throw new InvalidArgumentException('O preço de um produto não é válido.');
    }
    return (int)round((float)$value * 100, 0, PHP_ROUND_HALF_UP);
}

function pix_price_cents(array $product): int
{
    $price = money_cents($product['preco'] ?? null);
    return ($product['categoria'] ?? null) === 'Óculos inteligentes'
        ? (int)round($price * 0.8, 0, PHP_ROUND_HALF_UP) : $price;
}

function create_order(string $id, ?string $transaction, string $status, string $payment, string $method, int $total, array $customer, array $items, ?string $analytics, ?string $pixPayload = null): void
{
    $query = db()->prepare('INSERT INTO orders(id,transaction_id,analytics_session_id,created_at,status,payment_status,payment_method,total_cents,customer_json,items_json,pix_payload) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    $query->execute([$id, $transaction, $analytics, time(), $status, $payment, $method, $total,
        json_encode($customer, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        json_encode($items, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $pixPayload]);
}

function update_payment(string $orderId, string $status, bool $byTransaction = false): bool
{
    $pdo = db();
    $column = $byTransaction ? 'transaction_id' : 'id';
    $find = $pdo->prepare("SELECT id,payment_status,analytics_session_id FROM orders WHERE {$column}=?");
    $find->execute([$orderId]);
    $previous = $find->fetch();
    if (!$previous) {
        return false;
    }
    $normalized = strtolower($status);
    $orderStatus = match ($normalized) {
        'paid' => 'paid', 'cancelled' => 'cancelled', 'refunded' => 'refunded', default => 'awaiting_payment'
    };
    $update = $pdo->prepare("UPDATE orders SET payment_status=?,status=? WHERE {$column}=?");
    $update->execute([$normalized, $orderStatus, $orderId]);
    if ($normalized === 'paid' && $previous['payment_status'] !== 'paid' && $previous['analytics_session_id']) {
        $event = $pdo->prepare('SELECT page_path,source,device,browser FROM events WHERE session_id=? ORDER BY happened_at DESC LIMIT 1');
        $event->execute([$previous['analytics_session_id']]);
        $source = $event->fetch();
        if ($source) {
            $insert = $pdo->prepare('INSERT INTO events(event_name,happened_at,session_id,page_path,source,device,browser) VALUES(?,?,?,?,?,?,?)');
            $insert->execute(['purchase', time(), $previous['analytics_session_id'], '/checkout', $source['source'], $source['device'], $source['browser']]);
        }
    }
    return true;
}

function orders_list(int $limit = 200): array
{
    $query = db()->prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?');
    $query->bindValue(1, $limit, PDO::PARAM_INT);
    $query->execute();
    $result = [];
    foreach ($query->fetchAll() as $row) {
        $row['customer'] = json_decode($row['customer_json'], true) ?: [];
        $row['items'] = json_decode($row['items_json'], true) ?: [];
        unset($row['customer_json'], $row['items_json']);
        $result[] = $row;
    }
    return $result;
}

function product_report(): array
{
    $store = store_value() ?? [];
    $sold = [];
    foreach (db()->query("SELECT items_json FROM orders WHERE payment_status='paid'")->fetchAll() as $order) {
        foreach (json_decode($order['items_json'], true) ?: [] as $item) {
            if (isset($item['id'])) {
                $sold[(string)$item['id']] = ($sold[(string)$item['id']] ?? 0) + max(0, (int)($item['quantity'] ?? 0));
            }
        }
    }
    $result = [];
    foreach (($store['produtos'] ?? []) as $product) {
        if (!is_array($product)) {
            continue;
        }
        $price = null;
        try {
            $price = money_cents($product['preco'] ?? null);
        } catch (Throwable) {
        }
        $id = (string)($product['id'] ?? '');
        $result[] = ['id' => $id, 'name' => (string)($product['nome'] ?? ''),
            'category' => (string)($product['categoria'] ?? ''),
            'stock' => is_numeric($product['estoque'] ?? null) ? (int)$product['estoque'] : null,
            'priceCents' => $price, 'paidUnits' => $sold[$id] ?? 0];
    }
    return $result;
}

function dashboard(int $days): array
{
    $days = max(1, min(365, $days));
    $start = time() - ($days - 1) * 86400;
    $pdo = db();
    $query = $pdo->prepare("SELECT COUNT(*) AS n,SUM(CASE WHEN payment_status='paid' THEN total_cents ELSE 0 END) AS revenue,SUM(CASE WHEN payment_status IN ('pending','reported') THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN payment_status='paid' THEN 1 ELSE 0 END) AS paid FROM orders WHERE created_at>=?");
    $query->execute([$start]);
    $orders = $query->fetch();
    $visitorsQuery = $pdo->prepare('SELECT COUNT(DISTINCT session_id) FROM events WHERE happened_at>=?');
    $visitorsQuery->execute([$start]);
    $visitors = (int)$visitorsQuery->fetchColumn();
    $store = store_value() ?? [];
    $products = $store['produtos'] ?? [];
    $lowStock = count(array_filter($products, static fn($item) => is_array($item) && is_numeric($item['estoque'] ?? null) && (int)$item['estoque'] <= 3));
    $salesQuery = $pdo->prepare("SELECT DATE_FORMAT(FROM_UNIXTIME(created_at),'%Y-%m-%d') AS day,SUM(CASE WHEN payment_status='paid' THEN total_cents ELSE 0 END) AS cents,COUNT(*) AS orders FROM orders WHERE created_at>=? GROUP BY day ORDER BY day");
    $salesQuery->execute([$start]);
    $trafficQuery = $pdo->prepare("SELECT DATE_FORMAT(FROM_UNIXTIME(happened_at),'%Y-%m-%d') AS day,COUNT(DISTINCT session_id) AS visitors,COUNT(*) AS views FROM events WHERE happened_at>=? GROUP BY day ORDER BY day");
    $trafficQuery->execute([$start]);
    $customers = (int)$pdo->query("SELECT COUNT(DISTINCT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(customer_json,'$.email')),''),NULLIF(JSON_UNQUOTE(JSON_EXTRACT(customer_json,'$.phone')),''))) FROM orders")->fetchColumn();
    $paid = (int)($orders['paid'] ?? 0);
    return ['revenueCents' => (int)($orders['revenue'] ?? 0), 'orders' => (int)$orders['n'],
        'pendingOrders' => (int)($orders['pending'] ?? 0), 'paidOrders' => $paid,
        'products' => count($products), 'lowStock' => $lowStock, 'customers' => $customers,
        'visitors' => $visitors, 'conversionPercent' => $visitors ? round($paid / $visitors * 100, 2) : 0,
        'salesByDay' => $salesQuery->fetchAll(), 'trafficByDay' => $trafficQuery->fetchAll()];
}

function analytics_summary(int $start, int $end, array $filters): array
{
    $pdo = db();
    $columns = ['page' => 'page_path', 'product' => 'product_id', 'source' => 'source', 'device' => 'device'];
    $where = ['happened_at BETWEEN ? AND ?'];
    $params = [$start, $end];
    foreach ($columns as $key => $column) {
        $value = substr((string)($filters[$key] ?? ''), 0, 180);
        if ($value !== '') {
            $where[] = "{$column}=?";
            $params[] = $value;
        }
    }
    $clause = implode(' AND ', $where);
    $run = static function (string $sql, array $args) use ($pdo): array {
        $query = $pdo->prepare($sql);
        $query->execute($args);
        return $query->fetchAll();
    };
    $events = $run("SELECT event_name,COUNT(*) AS count,COUNT(DISTINCT session_id) AS sessions FROM events WHERE {$clause} GROUP BY event_name ORDER BY count DESC", $params);
    $pages = $run("SELECT page_path,COUNT(*) AS views,COUNT(DISTINCT session_id) AS visitors FROM events WHERE event_name='page_view' AND {$clause} GROUP BY page_path ORDER BY views DESC LIMIT 30", $params);
    $products = $run("SELECT product_id,COUNT(*) AS views,COUNT(DISTINCT session_id) AS visitors FROM events WHERE event_name='view_item' AND {$clause} GROUP BY product_id ORDER BY views DESC LIMIT 30", $params);
    $sources = $run("SELECT source,COUNT(DISTINCT session_id) AS visitors FROM events WHERE {$clause} GROUP BY source ORDER BY visitors DESC LIMIT 30", $params);
    $devices = $run("SELECT device,browser,COUNT(DISTINCT session_id) AS visitors FROM events WHERE {$clause} GROUP BY device,browser ORDER BY visitors DESC", $params);
    $latest = $run("SELECT happened_at,event_name,session_id,page_path,product_id,source,device,browser FROM events WHERE {$clause} ORDER BY happened_at DESC LIMIT 200", $params);
    $counts = [];
    foreach ($events as $event) {
        $counts[$event['event_name']] = (int)$event['count'];
    }
    return ['counts' => $counts, 'events' => $events, 'pages' => $pages, 'products' => $products,
        'sources' => $sources, 'devices' => $devices, 'latest' => $latest, 'ipCollection' => false];
}

function send_csv(string $kind, array $rows): never
{
    header('Content-Type: text/csv; charset=utf-8');
    header("Content-Disposition: attachment; filename=loja-{$kind}.csv");
    header('Cache-Control: no-store');
    echo "\xEF\xBB\xBF";
    $output = fopen('php://output', 'w');
    foreach ($rows as $row) {
        fputcsv($output, array_map(static function ($value) {
            if (is_string($value) && preg_match('/^\s*[=+\-@\t\r]/u', $value)) {
                return "'" . $value;
            }
            return is_array($value) ? json_encode($value, JSON_UNESCAPED_UNICODE) : $value;
        }, $row));
    }
    fclose($output);
    exit;
}

function call_blackcat(string $path, string $method, string $apiKey, ?array $payload = null): array
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('A extensão cURL do PHP precisa estar ativada para usar o gateway.');
    }
    $handle = curl_init(BLACKCAT_API . $path);
    $headers = ['X-API-Key: ' . $apiKey, 'Accept: application/json'];
    curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 25]);
    if ($payload !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($handle, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }
    $body = curl_exec($handle);
    $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    if ($body === false) {
        curl_close($handle);
        throw new RuntimeException('Não foi possível contactar a BlackCat.');
    }
    curl_close($handle);
    $decoded = json_decode($body, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('A BlackCat retornou uma resposta inválida.');
    }
    return [$status, $decoded];
}

function create_order_items(array $requested, array $store, bool $gateway = false): array
{
    $products = [];
    foreach (($store['produtos'] ?? []) as $product) {
        if (is_array($product) && isset($product['id'])) {
            $products[(string)$product['id']] = $product;
        }
    }
    $saleItems = [];
    $orderItems = [];
    $total = 0;
    foreach ($requested as $item) {
        if (!is_array($item)) {
            throw new InvalidArgumentException('Um produto do carrinho não está válido.');
        }
        $id = (string)($item['id'] ?? '');
        $product = $products[$id] ?? null;
        if (!$product) {
            throw new InvalidArgumentException('Um produto não está mais disponível no catálogo.');
        }
        $quantity = filter_var($item['quantity'] ?? null, FILTER_VALIDATE_INT);
        $stock = filter_var($product['estoque'] ?? null, FILTER_VALIDATE_INT);
        if ($quantity === false || $quantity < 1 || $stock === false || $quantity > $stock) {
            throw new InvalidArgumentException('Confira a quantidade e disponibilidade dos produtos.');
        }
        $price = pix_price_cents($product);
        $name = required_text($product['nome'] ?? null, 'produto', 200);
        $total += $price * $quantity;
        $orderItems[] = ['id' => $id, 'name' => $name, 'quantity' => $quantity, 'unitPriceCents' => $price];
        if ($gateway) {
            $saleItems[] = ['title' => $name, 'unitPrice' => $price, 'quantity' => $quantity, 'tangible' => true];
        }
    }
    if ($total < 1) {
        throw new InvalidArgumentException('O total do pedido não é válido.');
    }
    return [$orderItems, $total, $saleItems];
}

function route_request(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $pdo = db();
    if ($method === 'GET' && $path === '/merchant-feed.xml') {
        send_merchant_feed();
    }
    if ($method === 'GET' && $path === '/api/health') {
        respond(200, ['ok' => true, 'paymentConfigured' => config_value('blackcat_api_key') !== '',
            'adminConfigured' => (int)$pdo->query('SELECT COUNT(*) FROM admins')->fetchColumn() > 0]);
    }
    if ($method === 'GET' && $path === '/api/store') {
        $store = store_value();
        if ($store === null) {
            respond(404, ['error' => 'A loja ainda não foi sincronizada com o servidor.']);
        }
        respond(200, safe_store($store));
    }
    if ($method === 'GET' && $path === '/api/admin/session') {
        $session = current_session();
        if (!$session) {
            respond(401, ['error' => 'Sessão administrativa encerrada.']);
        }
        respond(200, ['success' => true, 'csrfToken' => $session['csrf_token'],
            'admin' => ['id' => (int)$session['admin_id'], 'username' => $session['username'], 'role' => $session['role']]]);
    }
    if ($method === 'GET' && preg_match('#^/api/payments/([A-Za-z0-9_-]{1,100})$#', $path, $match)) {
        payment_status($match[1]);
    }
    if ($method === 'GET' && $path === '/api/admin/dashboard') {
        require_admin();
        $days = filter_var($_GET['days'] ?? 30, FILTER_VALIDATE_INT);
        respond(200, dashboard($days === false ? 30 : $days));
    }
    if ($method === 'GET' && $path === '/api/admin/orders') {
        require_admin(false, ['owner']);
        respond(200, ['orders' => orders_list()]);
    }
    if ($method === 'GET' && $path === '/api/admin/customers') {
        require_admin(false, ['owner']);
        $rows = $pdo->query("SELECT MAX(JSON_UNQUOTE(JSON_EXTRACT(customer_json,'$.name'))) AS name,JSON_UNQUOTE(JSON_EXTRACT(customer_json,'$.email')) AS email,JSON_UNQUOTE(JSON_EXTRACT(customer_json,'$.phone')) AS phone,COUNT(*) AS orders,MAX(created_at) AS last_order FROM orders WHERE COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(customer_json,'$.email')),''),NULLIF(JSON_UNQUOTE(JSON_EXTRACT(customer_json,'$.phone')),'')) IS NOT NULL GROUP BY COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(customer_json,'$.email')),''),NULLIF(JSON_UNQUOTE(JSON_EXTRACT(customer_json,'$.phone')),'')) ORDER BY last_order DESC LIMIT 300")->fetchAll();
        respond(200, ['customers' => $rows]);
    }
    if ($method === 'GET' && $path === '/api/admin/products') {
        require_admin(false, ['owner']);
        respond(200, ['products' => product_report()]);
    }
    if ($method === 'GET' && $path === '/api/admin/accounts') {
        require_admin(false, ['owner']);
        respond(200, ['accounts' => $pdo->query('SELECT id,username,role,active,created_at FROM admins ORDER BY created_at')->fetchAll()]);
    }
    if ($method === 'GET' && $path === '/api/admin/analytics') {
        require_admin();
        $days = max(1, min(365, (int)($_GET['days'] ?? 30)));
        respond(200, analytics_summary(time() - ($days - 1) * 86400, time(),
            array_intersect_key($_GET, array_flip(['page', 'product', 'source', 'device']))));
    }
    if ($method === 'GET' && $path === '/api/admin/export.csv') {
        require_admin(false, ['owner']);
        export_csv((string)($_GET['kind'] ?? 'orders'));
    }
    if ($method === 'POST' && $path === '/api/admin/login') {
        if (rate_limited('admin-login', 8, 300)) {
            respond(429, ['error' => 'Muitas tentativas de acesso. Aguarde alguns minutos.']);
        }
        $data = json_body(16384);
        $username = required_text($data['username'] ?? null, 'usuário', 100);
        $password = $data['password'] ?? null;
        if (!is_string($password) || $password === '' || strlen($password) > 500) {
            throw new InvalidArgumentException('Confira o campo senha.');
        }
        $query = $pdo->prepare('SELECT * FROM admins WHERE username=? AND active=1');
        $query->execute([$username]);
        $admin = $query->fetch();
        if (!$admin || !password_verify($password, $admin['password_hash'])) {
            respond(401, ['error' => 'Usuário ou senha incorretos. Verifique a configuração do servidor.']);
        }
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $csrf = bin2hex(random_bytes(32));
        $insert = $pdo->prepare('INSERT INTO sessions(token_hash,admin_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)');
        $insert->execute([hash('sha256', $token), $admin['id'], $csrf, time() + SESSION_SECONDS, time()]);
        audit((int)$admin['id'], 'login', 'session');
        set_admin_cookie($token);
        respond(200, ['success' => true, 'csrfToken' => $csrf,
            'admin' => ['id' => (int)$admin['id'], 'username' => $admin['username'], 'role' => $admin['role']]]);
    }
    if ($method === 'POST' && $path === '/api/admin/logout') {
        $session = require_admin(true);
        $token = (string)($_COOKIE['mn_admin'] ?? '');
        audit((int)$session['admin_id'], 'logout', 'session');
        $delete = $pdo->prepare('DELETE FROM sessions WHERE token_hash=?');
        $delete->execute([hash('sha256', $token)]);
        set_admin_cookie('', true);
        respond(200, ['success' => true]);
    }
    if ($method === 'POST' && $path === '/api/admin/store') {
        $session = require_admin(true, ['owner']);
        $value = json_body();
        if (!is_array($value['loja'] ?? null) || !is_array($value['produtos'] ?? null)) {
            throw new InvalidArgumentException('Dados da loja ou do catálogo não estão válidos.');
        }
        if (count($value['produtos']) > 500) {
            throw new InvalidArgumentException('O catálogo excede o limite de produtos do servidor.');
        }
        if (isset($value['pagamento']) && (!is_array($value['pagamento']) || !in_array($value['pagamento']['metodo'] ?? null, ['pix', 'gateway'], true))) {
            throw new InvalidArgumentException('Escolha PIX ou gateway como forma de pagamento.');
        }
        $query = $pdo->prepare('INSERT INTO settings(`key`,`value`,updated_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`),updated_at=VALUES(updated_at)');
        $query->execute(['store', json_encode(safe_store($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), time()]);
        audit((int)$session['admin_id'], 'store_updated', 'store');
        respond(200, ['success' => true]);
    }
    if ($method === 'POST' && $path === '/api/admin/accounts') {
        create_analyst();
    }
    if ($method === 'DELETE' && preg_match('#^/api/admin/accounts/([0-9]+)$#', $path, $match)) {
        $session = require_admin(true, ['owner']);
        $query = $pdo->prepare("UPDATE admins SET active=0 WHERE id=? AND role='analyst' AND active=1");
        $query->execute([(int)$match[1]]);
        if (!$query->rowCount()) {
            respond(404, ['error' => 'Conta de análise não encontrada.']);
        }
        $delete = $pdo->prepare('DELETE FROM sessions WHERE admin_id=?');
        $delete->execute([(int)$match[1]]);
        audit((int)$session['admin_id'], 'account_deleted', 'admin', (int)$match[1]);
        respond(200, ['success' => true]);
    }
    if ($method === 'POST' && preg_match('#^/api/admin/orders/([A-Za-z0-9_-]{1,100})$#', $path, $match)) {
        $session = require_admin(true, ['owner']);
        $data = json_body(8192);
        $status = $data['paymentStatus'] ?? '';
        if (!in_array($status, ['pending', 'paid', 'cancelled', 'refunded', 'reported'], true)) {
            throw new InvalidArgumentException('Status de pagamento inválido.');
        }
        if (!update_payment($match[1], $status)) {
            respond(404, ['error' => 'Pedido não encontrado.']);
        }
        audit((int)$session['admin_id'], 'payment_status_changed', 'order', $match[1]);
        respond(200, ['success' => true]);
    }
    if ($method === 'POST' && $path === '/api/events') {
        collect_event();
    }
    if ($method === 'POST' && $path === '/api/orders/manual') {
        create_manual_order();
    }
    if ($method === 'POST' && preg_match('#^/api/orders/manual/([A-Za-z0-9_-]{1,100})/report$#', $path, $match)) {
        report_manual_order_payment($match[1]);
    }
    if ($method === 'POST' && $path === '/api/payments/blackcat') {
        create_blackcat_payment();
    }
    respond(404, ['error' => 'Não encontrado.']);
}

function create_analyst(): never
{
    $session = require_admin(true, ['owner']);
    if (rate_limited('create-analyst-' . $session['admin_id'], 10, 3600)) {
        respond(429, ['error' => 'Muitas tentativas de criação de conta. Tente novamente mais tarde.']);
    }
    $data = json_body(16384);
    $username = required_text($data['username'] ?? null, 'username', 50);
    $password = $data['password'] ?? null;
    if (!preg_match('/^[A-Za-z0-9._-]{3,50}$/', $username)) {
        throw new InvalidArgumentException('Use de 3 a 50 caracteres: letras, números, ponto, hífen ou sublinhado.');
    }
    if (!is_string($password) || strlen($password) < 12 || strlen($password) > 500) {
        throw new InvalidArgumentException('A senha deve ter pelo menos 12 caracteres.');
    }
    try {
        $query = db()->prepare('INSERT INTO admins(username,password_hash,role,created_at) VALUES(?,?,?,?)');
        $query->execute([$username, password_hash($password, PASSWORD_DEFAULT), 'analyst', time()]);
    } catch (PDOException $error) {
        if ((string)$error->getCode() === '23000') {
            respond(409, ['error' => 'Esse usuário já existe.']);
        }
        throw $error;
    }
    $id = (int)db()->lastInsertId();
    audit((int)$session['admin_id'], 'account_created', 'admin', $id);
    respond(201, ['success' => true, 'account' => ['id' => $id, 'username' => $username, 'role' => 'analyst']]);
}

function collect_event(): never
{
    if (rate_limited('analytics', 120, 60)) {
        respond(429, ['error' => 'Aguarde antes de enviar novos eventos.']);
    }
    $data = json_body(12288);
    $name = $data['name'] ?? '';
    if (!in_array($name, ['page_view', 'view_item', 'search', 'click_buy', 'add_to_cart', 'begin_checkout'], true)) {
        throw new InvalidArgumentException('Evento inválido.');
    }
    $sessionId = (string)($data['sessionId'] ?? '');
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $sessionId)) {
        throw new InvalidArgumentException('Sessão inválida.');
    }
    $page = substr((string)($data['page'] ?? '/'), 0, 240);
    if (!str_starts_with($page, '/') || str_contains($page, '?') || str_contains($page, '#')) {
        throw new InvalidArgumentException('Página inválida.');
    }
    $insert = db()->prepare('INSERT INTO events(event_name,happened_at,session_id,page_path,product_id,source,device,browser) VALUES(?,?,?,?,?,?,?,?)');
    $insert->execute([$name, time(), strtolower($sessionId), $page, substr((string)($data['productId'] ?? ''), 0, 120) ?: null,
        substr((string)($data['source'] ?? 'direct'), 0, 180), substr((string)($data['device'] ?? 'unknown'), 0, 30),
        substr((string)($data['browser'] ?? 'unknown'), 0, 30)]);
    $retention = max(30, min(365, (int)config_value('analytics_retention_days', '90')));
    $delete = db()->prepare('DELETE FROM events WHERE happened_at < ?');
    $delete->execute([time() - $retention * 86400]);
    respond(202, ['accepted' => true]);
}

function create_manual_order(): never
{
    if (rate_limited('manual-order', 12, 600)) {
        respond(429, ['error' => 'Muitas tentativas de envio. Aguarde e tente novamente.']);
    }
    $store = store_value();
    if (!$store) {
        respond(503, ['error' => 'A loja ainda não está configurada no servidor.']);
    }
    $data = json_body(65536);
    $customer = $data['customer'] ?? null;
    $requested = $data['items'] ?? null;
    if (!is_array($customer) || !is_array($requested) || !$requested) {
        throw new InvalidArgumentException('Dados do pedido incompletos.');
    }
    $orderId = required_text($data['orderId'] ?? null, 'pedido', 100);
    if (!preg_match('/^MN[A-F0-9]{20}$/', $orderId)) {
        throw new InvalidArgumentException('O identificador do pedido não é válido.');
    }
    $pixPayload = required_text($data['pixPayload'] ?? null, 'código PIX', 1000);
    $name = required_text($customer['name'] ?? null, 'nome', 120);
    $email = substr(trim((string)($customer['email'] ?? '')), 0, 254);
    $phone = preg_replace('/\D/', '', (string)($customer['phone'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new InvalidArgumentException('Informe um e-mail válido.');
    }
    if (strlen($phone) < 10 || strlen($phone) > 13) {
        throw new InvalidArgumentException('Informe um telefone válido com DDD.');
    }
    $shipping = is_array($data['shipping'] ?? null) ? $data['shipping'] : [];
    $safeCustomer = ['name' => $name, 'email' => $email, 'phone' => $phone, 'shipping' => []];
    foreach (['street', 'number', 'neighborhood', 'city', 'state', 'zipCode'] as $field) {
        $safeCustomer['shipping'][$field] = required_text($shipping[$field] ?? null, $field, 200);
    }
    foreach (['complement'] as $field) {
        $safeCustomer['shipping'][$field] = substr(trim((string)($shipping[$field] ?? '')), 0, 200);
    }
    $safeCustomer['shipping']['zipCode'] = preg_replace('/\D/', '', $safeCustomer['shipping']['zipCode']);
    $safeCustomer['shipping']['state'] = strtoupper($safeCustomer['shipping']['state']);
    if (strlen($safeCustomer['shipping']['zipCode']) !== 8 || strlen($safeCustomer['shipping']['state']) !== 2) {
        throw new InvalidArgumentException('Confira o CEP e o estado do endereço de entrega.');
    }
    [$items, $total] = create_order_items(array_slice($requested, 0, 50), $store);
    $pixDetails = pix_payload_details($pixPayload);
    if (!$pixDetails || $pixDetails['amountCents'] !== $total || $pixDetails['txid'] !== $orderId) {
        throw new InvalidArgumentException('O código PIX não corresponde ao valor e ao pedido. Gere uma nova cobrança.');
    }
    $existing = db()->prepare('SELECT payment_method,pix_payload FROM orders WHERE id=?');
    $existing->execute([$orderId]);
    $previous = $existing->fetch();
    if ($previous) {
        if ($previous['payment_method'] === 'pix_manual' && hash_equals((string)$previous['pix_payload'], $pixPayload)) {
            respond(200, ['success' => true, 'orderId' => $orderId, 'paymentStatus' => 'pending']);
        }
        respond(409, ['error' => 'Este identificador já foi usado. Gere um novo código PIX.']);
    }
    create_order($orderId, null, 'awaiting_payment', 'pending', 'pix_manual', $total,
        $safeCustomer, $items, analytics_session($data['analyticsSessionId'] ?? null), $pixPayload);
    respond(201, ['success' => true, 'orderId' => $orderId, 'paymentStatus' => 'pending']);
}

function pix_payload_details(string $payload): ?array
{
    if (!preg_match('/^[\x20-\x7E]{1,1000}$/D', $payload) || strlen($payload) < 12) {
        return null;
    }
    $checksumTag = strlen($payload) - 8;
    if (substr($payload, $checksumTag, 4) !== '6304') {
        return null;
    }
    $crc = 0xffff;
    $crcInput = substr($payload, 0, -4);
    for ($i = 0, $length = strlen($crcInput); $i < $length; $i++) {
        $crc ^= ord($crcInput[$i]) << 8;
        for ($bit = 0; $bit < 8; $bit++) {
            $crc = ($crc & 0x8000) ? (($crc << 1) ^ 0x1021) : ($crc << 1);
            $crc &= 0xffff;
        }
    }
    if (!hash_equals(sprintf('%04X', $crc), strtoupper(substr($payload, -4)))) {
        return null;
    }
    $parseFields = static function (string $data): ?array {
        $fields = [];
        for ($offset = 0, $length = strlen($data); $offset < $length;) {
            if ($length - $offset < 4) {
                return null;
            }
            $tag = substr($data, $offset, 2);
            $size = substr($data, $offset + 2, 2);
            if (!ctype_digit($tag) || !ctype_digit($size)) {
                return null;
            }
            $valueLength = (int)$size;
            $offset += 4;
            if ($valueLength > $length - $offset) {
                return null;
            }
            $fields[$tag] = substr($data, $offset, $valueLength);
            $offset += $valueLength;
        }
        return $fields;
    };
    $fields = $parseFields(substr($payload, 0, $checksumTag));
    if (!is_array($fields)) {
        return null;
    }
    $amount = $fields['54'] ?? null;
    $additional = isset($fields['62']) ? $parseFields($fields['62']) : null;
    $txid = is_array($additional) ? ($additional['05'] ?? null) : null;
    if (!is_string($amount) || !preg_match('/^(\d+)\.(\d{2})$/', $amount, $amountParts) || !is_string($txid)) {
        return null;
    }
    return ['amountCents' => (int)$amountParts[1] * 100 + (int)$amountParts[2], 'txid' => $txid];
}

function report_manual_order_payment(string $orderId): never
{
    if (rate_limited('report-manual-payment', 12, 600)) {
        respond(429, ['error' => 'Muitas tentativas. Aguarde e tente novamente.']);
    }
    $query = db()->prepare("UPDATE orders SET payment_status='reported',status='awaiting_payment_confirmation' WHERE id=? AND payment_method='pix_manual' AND payment_status='pending'");
    $query->execute([$orderId]);
    if (!$query->rowCount()) {
        $existing = db()->prepare('SELECT payment_status FROM orders WHERE id=? AND payment_method=?');
        $existing->execute([$orderId, 'pix_manual']);
        $status = $existing->fetchColumn();
        if ($status === false) {
            respond(404, ['error' => 'Pedido PIX não encontrado.']);
        }
        if ($status !== 'reported' && $status !== 'paid') {
            respond(409, ['error' => 'Este pedido não está aguardando confirmação de pagamento.']);
        }
    }
    respond(200, ['success' => true, 'paymentStatus' => 'reported']);
}

function create_blackcat_payment(): never
{
    if (rate_limited('create-payment', 8, 60)) {
        respond(429, ['error' => 'Muitas tentativas. Aguarde um minuto e tente novamente.']);
    }
    $apiKey = config_value('blackcat_api_key');
    if ($apiKey === '') {
        respond(503, ['error' => 'O gateway não está configurado no servidor.']);
    }
    $store = store_value();
    if (!$store || ($store['pagamento']['metodo'] ?? '') !== 'gateway') {
        respond(409, ['error' => 'A loja ainda não ativou o gateway no painel sincronizado.']);
    }
    $data = json_body(131072);
    $customer = $data['customer'] ?? null;
    $shipping = $data['shipping'] ?? null;
    $requested = $data['items'] ?? null;
    if (!is_array($customer) || !is_array($shipping) || !is_array($requested) || !$requested || count($requested) > 50) {
        throw new InvalidArgumentException('Preencha os dados do cliente e o endereço de envio.');
    }
    $name = required_text($customer['name'] ?? null, 'nome', 120);
    $email = required_text($customer['email'] ?? null, 'e-mail', 254);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new InvalidArgumentException('Informe um e-mail válido.');
    }
    $phone = preg_replace('/\D/', '', (string)($customer['phone'] ?? ''));
    if (strlen($phone) < 10 || strlen($phone) > 13) {
        throw new InvalidArgumentException('Informe um telefone válido com DDD.');
    }
    $document = preg_replace('/\D/', '', (string)($customer['document']['number'] ?? ''));
    if (strlen($document) !== 11) {
        throw new InvalidArgumentException('Informe um CPF válido para o pagamento.');
    }
    $address = ['name' => $name,
        'street' => required_text($shipping['street'] ?? null, 'rua', 200),
        'number' => required_text($shipping['number'] ?? null, 'número', 30),
        'complement' => substr(trim((string)($shipping['complement'] ?? '')), 0, 120),
        'neighborhood' => required_text($shipping['neighborhood'] ?? null, 'bairro', 120),
        'city' => required_text($shipping['city'] ?? null, 'cidade', 120),
        'state' => strtoupper(required_text($shipping['state'] ?? null, 'estado', 2)),
        'zipCode' => preg_replace('/\D/', '', (string)($shipping['zipCode'] ?? ''))];
    if (strlen($address['state']) !== 2 || strlen($address['zipCode']) !== 8) {
        throw new InvalidArgumentException('Confira o estado e o CEP do endereço de entrega.');
    }
    [$items, $total, $saleItems] = create_order_items($requested, $store, true);
    $externalRef = 'MN' . strtoupper(bin2hex(random_bytes(12)));
    $payload = ['amount' => $total, 'currency' => 'BRL', 'paymentMethod' => 'pix',
        'items' => $saleItems, 'customer' => ['name' => $name, 'email' => $email, 'phone' => $phone,
            'document' => ['number' => $document, 'type' => 'cpf']],
        'shipping' => $address, 'pix' => ['expiresInDays' => 1], 'externalRef' => $externalRef];
    try {
        [$status, $response] = call_blackcat('/sales/create-sale', 'POST', $apiKey, $payload);
    } catch (RuntimeException $error) {
        respond(502, ['error' => $error->getMessage()]);
    }
    $transaction = $response['data'] ?? null;
    if (!in_array($status, [200, 201], true) || !is_array($transaction) || empty($transaction['transactionId'])) {
        respond(502, ['error' => (string)($response['message'] ?? 'A BlackCat não criou a cobrança. Confira a configuração do gateway.')]);
    }
    $transactionId = (string)$transaction['transactionId'];
    $paymentData = is_array($transaction['paymentData'] ?? null) ? $transaction['paymentData'] : [];
    $pixPayload = trim((string)($paymentData['copyPaste'] ?? $paymentData['qrCode'] ?? ''));
    try {
        db()->beginTransaction();
        $insert = db()->prepare('INSERT INTO payment_transactions(transaction_id,amount,external_ref,created_at) VALUES(?,?,?,?)');
        $insert->execute([$transactionId, $total, $externalRef, time()]);
        create_order($externalRef, $transactionId, 'awaiting_payment', 'pending', 'blackcat', $total,
            ['name' => $name, 'email' => $email, 'phone' => $phone, 'shipping' => $address], $items,
            analytics_session($data['analyticsSessionId'] ?? null), $pixPayload !== '' ? $pixPayload : null);
        db()->commit();
    } catch (Throwable $error) {
        if (db()->inTransaction()) {
            db()->rollBack();
        }
        error_log('BlackCat sale created but order persistence failed: ' . $error->getMessage());
        respond(500, ['error' => 'A cobrança foi criada, mas não foi possível registrar o pedido. Entre em contato com a loja antes de tentar pagar novamente.']);
    }
    respond(201, ['success' => true, 'data' => ['transactionId' => $transactionId,
        'status' => $transaction['status'] ?? 'PENDING', 'amount' => $total,
        'invoiceUrl' => $transaction['invoiceUrl'] ?? null,
        'paymentData' => ['qrCode' => $paymentData['qrCode'] ?? null,
            'qrCodeBase64' => $paymentData['qrCodeBase64'] ?? null,
            'copyPaste' => $paymentData['copyPaste'] ?? null, 'expiresAt' => $paymentData['expiresAt'] ?? null]]]);
}

function payment_status(string $transactionId): never
{
    $apiKey = config_value('blackcat_api_key');
    if ($apiKey === '') {
        respond(503, ['error' => 'O gateway não está configurado no servidor.']);
    }
    if (rate_limited('payment-status', 60, 60)) {
        respond(429, ['error' => 'Muitas consultas. Aguarde e tente novamente.']);
    }
    $query = db()->prepare('SELECT amount FROM payment_transactions WHERE transaction_id=?');
    $query->execute([$transactionId]);
    $amount = $query->fetchColumn();
    if ($amount === false) {
        respond(404, ['error' => 'Não foi encontrado um pedido correspondente a esta cobrança.']);
    }
    try {
        [$status, $response] = call_blackcat('/sales/' . rawurlencode($transactionId) . '/status', 'GET', $apiKey);
    } catch (RuntimeException) {
        respond(502, ['error' => 'Não foi possível consultar o status na BlackCat.']);
    }
    $data = $response['data'] ?? null;
    if ($status !== 200 || !is_array($data) || ($data['transactionId'] ?? null) !== $transactionId || (int)($data['amount'] ?? -1) !== (int)$amount) {
        respond(502, ['error' => 'A BlackCat não confirmou o status nem o valor desta cobrança.']);
    }
    $state = $data['status'] ?? '';
    if (!in_array($state, ['PENDING', 'PAID', 'CANCELLED', 'REFUNDED'], true)) {
        respond(502, ['error' => 'A BlackCat retornou um status de pagamento desconhecido.']);
    }
    update_payment($transactionId, $state, true);
    respond(200, ['success' => true, 'data' => ['transactionId' => $transactionId,
        'status' => $state, 'amount' => (int)$data['amount'], 'paidAt' => $data['paidAt'] ?? null]]);
}

function export_csv(string $kind): never
{
    if ($kind === 'orders') {
        $rows = [['pedido', 'criado_em_unix_utc', 'status', 'pagamento', 'metodo', 'total_centavos', 'cliente', 'email', 'telefone', 'itens']];
        foreach (orders_list(5000) as $order) {
            $customer = $order['customer'];
            $rows[] = [$order['id'], $order['created_at'], $order['status'], $order['payment_status'], $order['payment_method'],
                $order['total_cents'], $customer['name'] ?? '', $customer['email'] ?? '', $customer['phone'] ?? '', $order['items']];
        }
        send_csv($kind, $rows);
    }
    if ($kind === 'products') {
        $rows = [['produto_id', 'nome', 'categoria', 'preco_centavos', 'estoque', 'unidades_pagas']];
        foreach (product_report() as $product) {
            $rows[] = [$product['id'], $product['name'], $product['category'], $product['priceCents'], $product['stock'], $product['paidUnits']];
        }
        send_csv($kind, $rows);
    }
    if ($kind === 'traffic') {
        $days = max(1, min(365, (int)($_GET['days'] ?? 30)));
        $query = db()->prepare('SELECT happened_at,event_name,session_id,page_path,product_id,source,device,browser FROM events WHERE happened_at>=? ORDER BY happened_at DESC');
        $query->execute([time() - ($days - 1) * 86400]);
        $rows = [['data_unix_utc', 'evento', 'sessao_anonima', 'pagina', 'produto', 'origem', 'dispositivo', 'navegador'], ...$query->fetchAll(PDO::FETCH_NUM)];
        send_csv($kind, $rows);
    }
    respond(400, ['error' => 'Tipo de exportação inválido.']);
}

try {
    route_request();
} catch (InvalidArgumentException $error) {
    respond(400, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log('Store API request failed: ' . $error->getMessage());
    respond(500, ['error' => 'O servidor não conseguiu concluir a solicitação. Tente novamente.']);
}
