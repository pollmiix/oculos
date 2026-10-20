# Administração, pedidos e integrações

Para publicar o painel e a API em hospedagem PHP/MySQL, consulte [PHP-HOSTING.md](./PHP-HOSTING.md). As instruções abaixo são para o servidor Python.

## Preparar o servidor

O painel administrativo usa autenticação mantida no servidor. Antes do primeiro início, configure em `.env` (local) ou nas variáveis do provedor (produção):

- `ADMIN_USERNAME`: usuário da conta proprietária.
- `ADMIN_PASSWORD`: senha exclusiva. Em produção, use pelo menos 12 caracteres. A senha é armazenada no banco somente como hash PBKDF2. A conta é criada no primeiro início em que essas variáveis estiverem configuradas.
- `BLACKCAT_API_KEY`: chave privada do gateway, mantida apenas no servidor.
- `ANALYTICS_RETENTION_DAYS`: retenção dos eventos consentidos, entre 30 e 365 dias (padrão 90).

Use `python server.py` para iniciar. Abra `/admin.html` pelo mesmo domínio do servidor; o acesso por `file://` não funciona. Se o banco já tiver uma conta proprietária, mudar as variáveis de ambiente não troca sua senha automaticamente.

O SQLite fica em `.data/store.sqlite3`; mantenha essa pasta em volume persistente e inclua-a nos backups protegidos. Não envie `.env`, `.data` nem credenciais ao Git. O servidor deve estar atrás de HTTPS em produção.

## Funcionalidades disponíveis

- Visão geral com totais reais do SQLite, catálogo sincronizado, pedidos pagos e pendentes, estoque baixo e visitantes que aceitaram analytics.
- Relatorios de pedidos e clientes reais, inventario com vendas pagas por produto e CSV autenticado para pedidos, trafego e estoque.
- Conta proprietaria pode criar/desativar contas de analise com acesso restrito a metricas; operacoes administrativas ficam no historico de auditoria. MFA ainda nao esta habilitado.
- Status dos pedidos do gateway consultado no servidor. PIX manual aparece como informado pelo cliente, não como pagamento confirmado.
- Eventos de página, produto, busca, carrinho e checkout são enviados somente depois do consentimento. O painel não grava endereço IP; métricas recusadas não são enviadas. O visitante pode reabrir “Privacidade” para alterar a escolha.
- Eventos são removidos após o prazo configurado. Os identificadores usados para contar sessões são aleatórios e pseudônimos.

A loja não mostra pedidos ou clientes fictícios: quando não houver registros, o painel apresenta listas vazias. A exportação de pedidos inclui dados pessoais informados no checkout e deve ser tratada como informação confidencial.

## Gateway BlackCat

A chave permanece no ambiente seguro do servidor. O servidor valida produtos, estoque e valores do catálogo sincronizado antes de criar uma cobrança e consulta o status ao gateway antes de marcar um pagamento como confirmado. A cobrança é registrada como pendente assim que criada. Um PIX gerado manualmente é registrado com estado `reported`, até que a loja confirme o pagamento.

No Render, mantenha o disco persistente montado em `.data`, preencha `ADMIN_PASSWORD` e `BLACKCAT_API_KEY` nas configurações do serviço, e aguarde a verificação `/api/health`. Faça qualquer validação do fluxo de pagamento primeiro com credenciais de teste oferecidas pelo gateway, se disponíveis. Nenhuma publicação é feita por este trabalho.

O frete permanece conforme as condições existentes da loja. Os dados de cliente são armazenados para processar pedidos e ficam acessíveis apenas no painel autenticado.
