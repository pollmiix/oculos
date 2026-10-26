<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/store-pricing.php';

$store = ['produtos' => [
    ['id' => 'one', 'preco' => 3726.41, 'antigo' => 4128.99, 'precoPix' => 100, 'precoPromocional' => 150, 'estoque' => 8],
    ['id' => 'two', 'preco' => null, 'antigo' => 0, 'estoque' => 0],
    ['id' => 'three', 'preco' => '123.45'],
]];
$reduced = reduced_store_prices($store);
$expected = [2235.85, 2477.39, 60.0, 90.0];
foreach (['preco', 'antigo', 'precoPix', 'precoPromocional'] as $i => $field) {
    if ($reduced['produtos'][0][$field] !== $expected[$i]) {
        throw new RuntimeException('Incorrect reduction: ' . $field);
    }
}
if ($reduced['produtos'][0]['estoque'] !== 8 || $reduced['produtos'][1]['preco'] !== null
    || $reduced['produtos'][2]['preco'] !== 74.07 || reduced_store_prices($reduced) !== $reduced) {
    throw new RuntimeException('Migration must preserve stock, unknown prices, and apply exactly once.');
}
echo "Store pricing tests passed.\n";
