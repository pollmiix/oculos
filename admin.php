<?php
declare(strict_types=1);

header('X-Robots-Tag: noindex, nofollow');
readfile(__DIR__ . '/admin.html');
