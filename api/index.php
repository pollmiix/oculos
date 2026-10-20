<?php
declare(strict_types=1);

// Vercel executes this entry point instead of serving PHP source as a download.
if (isset($_GET['__store_route'])) {
    $route = $_GET['__store_route'];
    unset($_GET['__store_route']);
    if (!is_string($route) || !preg_match('#^/(api(?:/[^?\r\n]*)?|merchant-feed\.xml)$#D', $route)) {
        http_response_code(404);
        exit;
    }
    $_SERVER['REQUEST_URI'] = $route;
}
require dirname(__DIR__) . '/api.php';
