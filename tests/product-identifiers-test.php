<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require dirname(__DIR__) . '/product-identifiers.php';

function check_identity(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

foreach (['036000291452', '4006381333931', '96385074', '00036000291452'] as $gtin) {
    check_identity(valid_product_gtin($gtin), 'Valid GTIN rejected.');
}
foreach (['4006381333932', '123', 'abcd', '4006381333931x'] as $gtin) {
    check_identity(!valid_product_gtin($gtin), 'Invalid GTIN accepted.');
}
foreach (['Ray-Ban', 'Polo Ralph Lauren', 'Prada Linea Rossa', 'Ralph', 'Dolce & Gabbana'] as $brand) {
    $identity = product_identifiers(['nome' => 'Óculos de Grau ' . $brand . ' Modelo 123', 'sku' => 'SKU-DA-LOJA']);
    check_identity($identity['brand'] === $brand, 'Brand not matched correctly.');
    check_identity($identity['identifier_exists'] === true, 'Branded item marked as lacking identifiers.');
    check_identity($identity['gtin'] === '' && $identity['mpn'] === '', 'Identifiers invented from a merchant SKU.');
}
check_identity(product_identifiers(['nome' => 'Armação artesanal'])['identifier_exists'] === null, 'Unknown identifiers should not be declared absent.');
check_identity(product_identifiers(['nome' => 'Armação artesanal', 'identifier_exists' => false])['identifier_exists'] === false, 'Explicit identifier absence not preserved.');
check_identity(product_identifiers(['nome' => 'Ray-Ban', 'marca' => 'Marca cadastrada'])['brand'] === 'Marca cadastrada', 'Explicit brand overwritten.');
echo "Product identifier tests passed.\n";
