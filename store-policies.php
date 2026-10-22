<?php
declare(strict_types=1);

// Business conditions confirmed by the store owner on 2026-10-22.
function confirmed_store_policies(array $store): array
{
    $store['entrega'] = [
        'pais' => 'BR',
        'freteGratis' => true,
        'prazoDiasUteis' => 7,
        'prazoInicio' => 'confirmacao_pagamento',
    ];
    $pix = is_array($store['pix'] ?? null) ? $store['pix'] : [];
    if (trim((string)($pix['nomeRecebedor'] ?? '')) === '') {
        $pix['nomeRecebedor'] = 'Vemari Otica LTDA';
    }
    if (trim((string)($pix['cidade'] ?? '')) === '') {
        $pix['cidade'] = 'São Paulo';
    }
    $store['pix'] = $pix;
    return $store;
}
