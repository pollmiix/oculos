<?php
declare(strict_types=1);

// Vercel executes this entry point instead of serving PHP source as a download.
if (isset($_GET['__store_route'])) {
    $route = $_GET['__store_route'];
    unset($_GET['__store_route']);
    if (!is_string($route) || !preg_match('#^/(admin|api(?:/[^?\r\n]*)?|merchant-feed\.xml)$#D', $route)) {
        http_response_code(404);
        exit;
    }
    $_SERVER['REQUEST_URI'] = $route;
}
if (parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) === '/admin') {
    require dirname(__DIR__) . '/admin.php';
    exit;
}
require dirname(__DIR__) . '/api.php';
