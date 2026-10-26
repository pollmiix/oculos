<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/store-pricing.php';
$prices = json_decode(file_get_contents(dirname(__DIR__) . '/smart-product-prices.json'), true, 512, JSON_THROW_ON_ERROR);
if (count($prices) !== 16 || count(array_unique($prices)) !== 16 || min($prices) !== 1459.64 || max($prices) !== 1543.64) {
    throw new RuntimeException('Expected sixteen distinct prices in the requested range.');
}
$products = [];
foreach ($prices as $id => $price) {
    $products[] = ['id' => $id, 'categoria' => 'Óculos inteligentes', 'preco' => 2000, 'antigo' => 2500, 'estoque' => 3];
}
$other = ['id' => 'other', 'categoria' => 'Outros óculos de grau', 'preco' => 500, 'estoque' => 2];
$products[] = $other;
$result = fixed_smart_product_prices(['versaoReducaoPrecos' => 2, 'produtos' => $products]);
foreach ($result['produtos'] as $i => $product) {
    if ($i === 16) {
        if ($product !== $other) throw new RuntimeException('Other collections must remain unchanged.');
        continue;
    }
    foreach (['preco', 'precoPix', 'precoPromocional'] as $field) {
        if ($product[$field] !== $prices[$product['id']]) throw new RuntimeException('Incorrect fixed price.');
    }
    if ($product['aplicarDescontoPix'] !== false || $product['estoque'] !== 3 || $product['antigo'] !== 2500) {
        throw new RuntimeException('Final prices, stock and original prices must be preserved.');
    }
}
$result['produtos'][0]['preco'] = 1500;
if (fixed_smart_product_prices($result) !== $result) {
    throw new RuntimeException('Repeated migration must preserve subsequent admin edits.');
}
echo "Smart product pricing tests passed.\n";
