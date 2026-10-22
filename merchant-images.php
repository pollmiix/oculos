<?php
declare(strict_types=1);

function merchant_image_url(string $source, string $baseUrl): ?string
{
    $source = trim($source);
    if ($source === '' || str_contains($source, '\\') || preg_match('/[\x00-\x20]/', $source)) {
        return null;
    }
    if (str_starts_with($source, '//')) {
        $source = 'https:' . $source;
    } elseif (!preg_match('/^[a-z][a-z0-9+.-]*:/i', $source)) {
        if (str_starts_with($source, '#') || str_starts_with($source, '?')) {
            return null;
        }
        $source = rtrim($baseUrl, '/') . '/' . ltrim($source, '/');
    }
    if (!filter_var($source, FILTER_VALIDATE_URL)
        || strtolower((string)parse_url($source, PHP_URL_SCHEME)) !== 'https'
        || parse_url($source, PHP_URL_USER) !== null
        || parse_url($source, PHP_URL_PASS) !== null) {
        return null;
    }
    return $source;
}
