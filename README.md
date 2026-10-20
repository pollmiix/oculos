# Vemari Ótica

Loja de óculos com catálogo, carrinho, painel administrativo e API de pedidos.

## Executar localmente

Requer Python 3.10 ou superior. O servidor usa apenas a biblioteca padrão do Python.

1. Copie `.env.example` para `.env`.
2. Preencha `ADMIN_USERNAME` e `ADMIN_PASSWORD` com credenciais exclusivas. Use uma senha com pelo menos 12 caracteres.
3. Execute `python server.py` na pasta do projeto.
4. Abra `http://127.0.0.1:8000` para visualizar a loja. O painel atual está em `admin.php` e requer hospedagem PHP, conforme as instruções abaixo.
5. Salve o catálogo no painel para sincronizá-lo com o servidor.

## Publicar a loja

O GitHub guarda o código. O GitHub Pages serve arquivos estáticos e não executa os servidores Python/PHP necessários para painel, pedidos e pagamentos.

- **Python no Render:** conecte este repositório e use `render.yaml` como Blueprint. Ele configura o servidor e um disco persistente para `.data`. O serviço e o disco usam recursos pagos; confira o plano antes de criar. Informe `ADMIN_PASSWORD`, `PUBLIC_BASE_URL` com a URL pública HTTPS e, se for usar o gateway, `BLACKCAT_API_KEY` nas variáveis privadas do provedor. Para não usar o gateway, deixe sua chave vazia.
- **PHP com MySQL:** siga [PHP-HOSTING.md](PHP-HOSTING.md). Configure `config.local.php` diretamente na hospedagem e use `/admin.php` para entrar.
- **PHP na Vercel:** `vercel.json` configura o runtime comunitário PHP e as rotas da API. Requer um MySQL externo com acesso pela Vercel e variáveis privadas de ambiente. Siga [VERCEL-PHP.md](VERCEL-PHP.md).

Depois da publicação, confira `/api/health`, entre no painel, salve o catálogo e verifique preços, estoque, entrega e pagamento antes de liberar vendas. Enviar o código ao GitHub não transfere o banco de dados nem ativa pagamentos.

## Credenciais e dados

Não publique `.env`, `config.local.php`, bancos de dados ou a pasta `.data`. Os arquivos de exemplo não devem conter senhas reais. Credenciais de produção devem ser configuradas somente na hospedagem.

## Documentação

- [Hospedagem PHP/MySQL](PHP-HOSTING.md)
- [Administração e integração de pagamentos](BLACKCAT-INTEGRACAO.md)
