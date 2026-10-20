<?php
declare(strict_types=1);

// Shared by Apache hosting and the Vercel PHP function. Never returns credentials over HTTP.
function store_config(): array
{
    static $config = null;
    if (is_array($config)) {
        return $config;
    }
    $config = [];
    $localPath = __DIR__ . '/config.local.php';
    if (is_file($localPath)) {
        $local = require $localPath;
        if (!is_array($local)) {
            throw new RuntimeException('config.local.php must return an array.');
        }
        $config = $local;
    }
    $variables = [
        'db_host' => 'DB_HOST', 'db_port' => 'DB_PORT',
        'db_name' => 'DB_NAME', 'db_user' => 'DB_USER', 'db_password' => 'DB_PASSWORD',
        'db_ssl_ca' => 'DB_SSL_CA', 'admin_username' => 'ADMIN_USERNAME',
        'admin_password' => 'ADMIN_PASSWORD', 'app_secret' => 'APP_SECRET',
        'blackcat_api_key' => 'BLACKCAT_API_KEY',
        'analytics_retention_days' => 'ANALYTICS_RETENTION_DAYS',
        'public_base_url' => 'PUBLIC_BASE_URL',
    ];
    foreach ($variables as $key => $variable) {
        $value = getenv($variable);
        if ($value !== false) {
            $config[$key] = $value;
        }
    }
    $bundledCa = __DIR__ . '/certs/aiven-ca.crt';
    if (empty($config['db_ssl_ca']) && is_file($bundledCa)) {
        $config['db_ssl_ca'] = $bundledCa;
    }
    return $config;
}
