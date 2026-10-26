<?php
declare(strict_types=1);

// Store-wide price reduction requested on 2026-10-26. Persist the version so
// later admin edits and repeated requests do not receive another reduction.
function reduced_store_prices(array $store): array
{
    if ((int)($store['versaoReducaoPrecos'] ?? 0) >= 2) {
        return $store;
    }
    for ($version = (int)($store['versaoReducaoPrecos'] ?? 0); $version < 2; $version++) {
        $factor = $version === 0 ? 0.6 : 0.8;
        if (is_array($store['produtos'] ?? null)) {
            foreach ($store['produtos'] as &$product) {
                if (!is_array($product)) {
                    continue;
                }
                foreach (['preco', 'antigo', 'precoPix', 'precoPromocional'] as $field) {
                    if (isset($product[$field]) && is_numeric($product[$field])) {
                        $product[$field] = round((float)$product[$field] * $factor, 2, PHP_ROUND_HALF_UP);
                    }
                }
            }
            unset($product);
        }
    }
    $store['versaoReducaoPrecos'] = 2;
    return $store;
}

function fixed_smart_product_prices(array $store): array
{
    if ((int)($store['versaoPrecosInteligentes'] ?? 0) >= 1) {
        return $store;
    }
    $prices = json_decode(file_get_contents(__DIR__ . '/smart-product-prices.json'), true, 512, JSON_THROW_ON_ERROR);
    if (is_array($store['produtos'] ?? null)) {
        foreach ($store['produtos'] as &$product) {
            $price = $prices[(string)($product['id'] ?? '')] ?? null;
            if ($price === null || ($product['categoria'] ?? '') !== 'Óculos inteligentes') {
                continue;
            }
            $product['preco'] = $price;
            $product['precoPix'] = $price;
            $product['precoPromocional'] = $price;
            $product['aplicarDescontoPix'] = false;
        }
        unset($product);
    }
    $store['versaoPrecosInteligentes'] = 1;
    return $store;
}
