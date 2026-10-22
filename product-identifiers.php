<?php
declare(strict_types=1);

function valid_product_gtin(string $value): bool
{
    if (!preg_match('/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/D', $value) || preg_match('/^0+$/D', $value)) {
        return false;
    }
    $sum = 0;
    $weight = 3;
    for ($index = strlen($value) - 2; $index >= 0; $index--) {
        $sum += (int)$value[$index] * $weight;
        $weight = $weight === 3 ? 1 : 3;
    }
    return (10 - $sum % 10) % 10 === (int)$value[strlen($value) - 1];
}

function product_identifiers(array $product): array
{
    $brand = trim((string)($product['marca'] ?? $product['brand'] ?? ''));
    if ($brand === '') {
        // Recognize only brands explicitly named in the product title.
        // This does not claim that the shop is an authorized representative.
        $brands = [
            'Prada Linea Rossa', 'Polo Ralph Lauren', 'Armani Exchange', 'Emporio Armani',
            'Giorgio Armani', 'Christian Dior', 'Dolce & Gabbana', 'Scuderia Ferrari',
            'Oliver Peoples', 'Michael Kors', 'Jimmy Choo', 'Ray-Ban', 'Miu Miu',
            'Burberry', 'Bvlgari', 'Celine', 'Fendi', 'Lacoste', 'Loewe', 'Persol',
            'Prada', 'Ralph', 'Reserva', 'Swarovski', 'Tiffany',
        ];
        foreach ($brands as $candidate) {
            if (preg_match('/(?<![\p{L}\p{N}])' . preg_quote($candidate, '/') . '(?![\p{L}\p{N}])/iu', (string)($product['nome'] ?? ''))) {
                $brand = $candidate;
                break;
            }
        }
    }
    $gtin = trim((string)($product['gtin'] ?? ''));
    return [
        'brand' => $brand,
        'gtin' => valid_product_gtin($gtin) ? $gtin : '',
        // A merchant SKU is not necessarily a manufacturer part number.
        'mpn' => trim((string)($product['mpn'] ?? '')),
        'identifier_exists' => $brand !== '' || $gtin !== '' || !empty($product['mpn'])
            ? true : (($product['identifier_exists'] ?? null) === false ? false : null),
    ];
}

function confirmed_product_description(array $product): string
{
    $description = trim((string)($product['descricao'] ?? ''));
    if (!is_numeric($product['preco'] ?? null) || (float)$product['preco'] <= 0) {
        return $description;
    }
    // The owner confirmed that the published products, prices and stock are real.
    // Remove old import boilerplate, preserving the product's actual description.
    $boilerplate = [
        'Produto consultado no catálogo da Coliseu.',
        'Confirme a disponibilidade e as especificações antes da compra.',
        'Preços de referência informados para conferência; confirme preço, disponibilidade e especificações com a loja antes da compra.',
        'Preço de referência consultado no catálogo oficial; confirme valor e disponibilidade com a loja antes da compra.',
        'O preço não estava disponível na referência informada; consulte e confirme o valor com a loja antes da compra.',
    ];
    $description = trim(str_replace($boilerplate, '', $description));
    return $description !== '' ? $description : trim((string)($product['nome'] ?? ''));
}
