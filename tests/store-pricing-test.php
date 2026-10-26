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
$expected = [1788.68, 1981.91, 48.0, 72.0];
foreach (['preco', 'antigo', 'precoPix', 'precoPromocional'] as $i => $field) {
    if ($reduced['produtos'][0][$field] !== $expected[$i]) {
        throw new RuntimeException('Incorrect reduction: ' . $field);
    }
}
if ($reduced['produtos'][0]['estoque'] !== 8 || $reduced['produtos'][1]['preco'] !== null
    || $reduced['produtos'][2]['preco'] !== 59.26 || reduced_store_prices($reduced) !== $reduced) {
    throw new RuntimeException('Migration must preserve stock, unknown prices, and apply exactly once.');
}
$current = ['versaoReducaoPrecos' => 1, 'produtos' => [['preco' => 100, 'antigo' => 150, 'precoPix' => 90, 'precoPromocional' => 95, 'estoque' => 4]]];
$next = reduced_store_prices($current);
if ($next['produtos'][0] !== ['preco' => 80.0, 'antigo' => 120.0, 'precoPix' => 72.0, 'precoPromocional' => 76.0, 'estoque' => 4]
    || $next['versaoReducaoPrecos'] !== 2 || reduced_store_prices($next) !== $next) {
    throw new RuntimeException('Existing reduced catalogs must receive only the additional 20% once.');
}
echo "Store pricing tests passed.\n";
