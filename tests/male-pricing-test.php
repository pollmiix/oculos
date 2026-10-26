<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/store-pricing.php';
$prices = json_decode(file_get_contents(dirname(__DIR__) . '/male-product-prices.json'), true, 512, JSON_THROW_ON_ERROR);
if (count($prices) !== 47 || count(array_unique($prices)) !== 47 || min($prices) !== 187.98 || max($prices) !== 217.65) {
    throw new RuntimeException('Expected 47 distinct prices within the requested range.');
}
$products = [];
foreach ($prices as $id => $price) {
    $products[] = ['id' => $id, 'categoria' => 'Armações masculinas', 'preco' => 600, 'antigo' => 700, 'estoque' => 4];
}
$other = ['id' => 'smart', 'categoria' => 'Óculos inteligentes', 'preco' => 1500, 'precoPix' => 1275, 'estoque' => 2];
$products[] = $other;
$result = male_product_prices(['versaoPrecosMasculinos' => 1, 'produtos' => $products]);
foreach ($result['produtos'] as $i => $product) {
    if ($i === 47) {
        if ($product !== $other) throw new RuntimeException('Other collections must remain unchanged.');
        continue;
    }
    $base = $prices[$product['id']];
    if ($product['preco'] !== $base || $product['precoPromocional'] !== $base
        || $product['precoPix'] !== round($base * 0.9, 2, PHP_ROUND_HALF_UP)
        || $product['aplicarDescontoPix'] !== true || $product['estoque'] !== 4 || $product['antigo'] !== 700) {
        throw new RuntimeException('Male base/Pix prices or preserved fields are incorrect.');
    }
}
$result['produtos'][0]['preco'] = 475;
if (male_product_prices($result) !== $result) throw new RuntimeException('Repeated migration must preserve admin edits.');
echo "Male pricing tests passed.\n";
