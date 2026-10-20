<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$directory = sys_get_temp_dir() . '/vemari-config-test-' . bin2hex(random_bytes(8));
mkdir($directory, 0700);
try {
    copy(dirname(__DIR__) . '/store-config.php', $directory . '/store-config.php');
    file_put_contents($directory . '/config.local.php', '<?php return ' . var_export([
        'db_host' => 'local.example', 'db_port' => 3306, 'db_password' => 'local-test-password',
        'admin_username' => 'local-admin', 'admin_password' => 'local-test-admin-password',
    ], true) . ';');
    putenv('DB_HOST=remote.example');
    putenv('DB_PORT=25060');
    putenv('DB_PASSWORD=');
    putenv('ADMIN_USERNAME');
    putenv('ADMIN_PASSWORD');
    require $directory . '/store-config.php';
    $config = store_config();
    if ($config['db_host'] !== 'remote.example' || $config['db_port'] !== '25060'
        || $config['db_password'] !== '' || $config['admin_username'] !== 'local-admin'
        || $config['admin_password'] !== 'local-test-admin-password') {
        throw new RuntimeException('Environment precedence or local hosting compatibility failed.');
    }
    putenv('DB_HOST=changed.example');
    if (store_config()['db_host'] !== 'remote.example') {
        throw new RuntimeException('Configuration must remain consistent within one request.');
    }
    echo "PHP configuration tests passed.\n";
} finally {
    foreach (['store-config.php', 'config.local.php'] as $file) {
        if (is_file($directory . '/' . $file)) {
            unlink($directory . '/' . $file);
        }
    }
    rmdir($directory);
}
