<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require dirname(__DIR__) . '/merchant-images.php';

$base = 'https://vemariotica.online';
$cases = [
    ['imagens/produto.jpg', $base . '/imagens/produto.jpg'],
    ['/imagens/produto.jpg', $base . '/imagens/produto.jpg'],
    [' https://cdn.example.com/foto.webp?width=800&height=800 ', 'https://cdn.example.com/foto.webp?width=800&height=800'],
    ['//cdn.example.com/foto.jpg', 'https://cdn.example.com/foto.jpg'],
    ['', null],
    ['http://cdn.example.com/foto.jpg', null],
    ['data:image/png;base64,abc', null],
    ['https://user:password@cdn.example.com/foto.jpg', null],
    ["https://cdn.example.com/foto.jpg\ninvalid", null],
    ['#foto', null],
    ['?foto=1', null],
    ['\\\\cdn.example.com/foto.jpg', null],
];
foreach ($cases as [$source, $expected]) {
    if (merchant_image_url($source, $base) !== $expected) {
        throw new RuntimeException('Image URL validation failed.');
    }
}
echo "Merchant image URL tests passed (" . count($cases) . " cases).\n";
