<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require dirname(__DIR__) . '/store-policies.php';
require dirname(__DIR__) . '/product-identifiers.php';

$result = confirmed_store_policies(['pix' => ['chave' => 'test-key', 'nomeRecebedor' => '', 'cidade' => ''], 'produtos' => [['preco' => 123.45, 'estoque' => 2]]]);
if ($result['pix']['chave'] !== 'test-key' || $result['pix']['nomeRecebedor'] !== 'Vemari Otica LTDA'
    || $result['pix']['cidade'] !== 'São Paulo' || $result['entrega']['freteGratis'] !== true
    || $result['entrega']['prazoDiasUteis'] !== 7 || $result['produtos'][0]['estoque'] !== 2
    || $result['produtos'][0]['preco'] !== 123.45) {
    throw new RuntimeException('Confirmed policies changed payment key or commercial product data.');
}
$customPix = confirmed_store_policies(['pix' => ['nomeRecebedor' => 'Recebedor atualizado', 'cidade' => 'Guarulhos']]);
if ($customPix['pix']['nomeRecebedor'] !== 'Recebedor atualizado' || $customPix['pix']['cidade'] !== 'Guarulhos') {
    throw new RuntimeException('An explicit updated beneficiary must be preserved.');
}
$title = 'Óculos de Grau Lacoste Modelo 123';
$description = confirmed_product_description(['nome' => $title, 'preco' => 100, 'descricao' => 'Produto consultado no catálogo da Coliseu. Confirme a disponibilidade e as especificações antes da compra.']);
if ($description !== $title) {
    throw new RuntimeException('Imported reference-only description not normalized.');
}
$technical = 'Armação preta. Recursos variam conforme a região.';
if (confirmed_product_description(['nome' => $title, 'preco' => 100, 'descricao' => $technical]) !== $technical) {
    throw new RuntimeException('Technical product information was modified.');
}
echo "Confirmed store policy tests passed.\n";
