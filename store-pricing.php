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

function smart_product_pix_discount(array $store): array
{
    if ((int)($store['versaoDescontoPixInteligentes'] ?? 0) >= 1) return $store;
    $prices = json_decode(file_get_contents(__DIR__ . '/smart-product-prices.json'), true, 512, JSON_THROW_ON_ERROR);
    if (is_array($store['produtos'] ?? null)) {
        foreach ($store['produtos'] as &$product) {
            if (!isset($prices[(string)($product['id'] ?? '')]) || ($product['categoria'] ?? '') !== 'Óculos inteligentes') continue;
            $product['aplicarDescontoPix'] = true;
            $product['precoPix'] = round((float)$product['preco'] * 0.85, 2, PHP_ROUND_HALF_UP);
        }
        unset($product);
    }
    $store['versaoDescontoPixInteligentes'] = 1;
    return $store;
}

function female_product_prices(array $store): array
{
    if ((int)($store['versaoPrecosFemininos'] ?? 0) >= 1) return $store;
    $prices = json_decode(file_get_contents(__DIR__ . '/female-product-prices.json'), true, 512, JSON_THROW_ON_ERROR);
    if (is_array($store['produtos'] ?? null)) {
        foreach ($store['produtos'] as &$product) {
            $price = $prices[(string)($product['id'] ?? '')] ?? null;
            if ($price === null || ($product['categoria'] ?? '') !== 'Armações femininas') continue;
            $product['preco'] = $price;
            $product['precoPromocional'] = $price;
            $product['precoPix'] = round($price * 0.9, 2, PHP_ROUND_HALF_UP);
            $product['aplicarDescontoPix'] = true;
        }
        unset($product);
    }
    $store['versaoPrecosFemininos'] = 1;
    return $store;
}

function male_product_prices(array $store): array
{
    if ((int)($store['versaoPrecosMasculinos'] ?? 0) >= 1) return $store;
    $prices = json_decode(file_get_contents(__DIR__ . '/male-product-prices.json'), true, 512, JSON_THROW_ON_ERROR);
    if (is_array($store['produtos'] ?? null)) {
        foreach ($store['produtos'] as &$product) {
            $price = $prices[(string)($product['id'] ?? '')] ?? null;
            if ($price === null || ($product['categoria'] ?? '') !== 'Armações masculinas') continue;
            $product['preco'] = $price;
            $product['precoPromocional'] = $price;
            $product['precoPix'] = round($price * 0.9, 2, PHP_ROUND_HALF_UP);
            $product['aplicarDescontoPix'] = true;
        }
        unset($product);
    }
    $store['versaoPrecosMasculinos'] = 1;
    return $store;
}
