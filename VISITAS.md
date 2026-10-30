# Lista de visitas

Entre em `admin.php` como proprietário e abra **Visão geral** ou **Lista de visitas**.
A tabela mostra uma linha por sessão de navegação, com última atividade, IP, sistema,
dispositivo, navegador, status online, etapa/produto, página, origem e localização aproximada.
Tem 25 registros por página, filtros e atualização automática a cada 15 segundos,
que pode ser desligada. Uma sessão fica online enquanto teve atividade nos últimos 90 segundos;
o navegador visível envia uma atualização de presença a cada 30 segundos.

Os novos registros começam quando o visitante aceita as métricas. O aviso e a política
foram atualizados para informar a coleta de IP; visitantes que aceitaram a versão anterior
precisam escolher novamente. Não é possível recuperar IPs ou localização de visitas antigas.
O prazo de retenção segue `ANALYTICS_RETENTION_DAYS` (90 dias por padrão).

- **Bloquear IP:** impede o uso das APIs públicas da loja, incluindo catálogo e criação de
  pedidos, por esse IP. Pessoas que compartilham a mesma rede podem ser afetadas.
  Os arquivos estáticos não são bloqueados no CDN. As rotas administrativas e webhooks
  continuam acessíveis, permitindo desbloquear sem interromper a confirmação de pagamentos.
- **Desbloquear IP / Desbloquear todos os IPs:** remove os bloqueios. Bloqueios permanecem
  até serem removidos pelo proprietário, mesmo se a visita tiver sido excluída.
- **Excluir:** apaga a sessão da lista e seus eventos de navegação. Preserva pedidos e
  pagamentos. Se a pessoa continuar navegando com consentimento, uma nova atividade pode
  fazer a sessão aparecer novamente.

As ações exigem sessão de proprietário e token CSRF. As contas de análise mantêm acesso
aos relatórios agregados, sem acesso à lista de IPs. As operações são auditadas.
Na Vercel, IP e localização usam os cabeçalhos da própria plataforma somente quando
`VERCEL=1`. Fora dela, o PHP e o Python usam o IP da conexão direta; não confiam em
cabeçalhos de proxy arbitrários. A localização fica **Não disponível** se a hospedagem
não fornecer os dados. Não é feita consulta a serviço externo de geolocalização.

O PHP cria as novas tabelas automaticamente ao inicializar a nova versão do esquema.
O pacote da função Vercel inclui `visitors.php`. O servidor Python tem a mesma API de visitas.

Validação: `python tests/visitors-test.py`, `php tests/visitors-test.php` (PDO SQLite),
e `node tests/admin-visitors.browser.cjs` com Playwright instalado ou indicado em
`PLAYWRIGHT_MODULE_PATH`. O teste de navegador usa dados fictícios e um servidor local.
