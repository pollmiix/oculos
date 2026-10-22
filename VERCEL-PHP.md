# PHP e MySQL na Vercel

O repositório inclui `vercel.json` e `api/index.php` para executar a API com o runtime comunitário `vercel-php@0.9.0`. A tela do painel está diretamente em `/admin.php`; o antigo endereço `/admin.html` redireciona para ela.

## 1. Banco de dados

Use um banco MySQL persistente, acessível pela rede a partir da Vercel. Um banco que só aceita conexões de `localhost` na hospedagem PHP não funciona como banco remoto da Vercel. Não use SQLite temporário para guardar pedidos.

O usuário do banco precisa criar tabelas e índices, alterar tabelas e ler/gravar os dados da loja. Para conexões remotas, configure TLS com o certificado CA indicado pelo provedor. Não desative a verificação do certificado.

## 2. Variáveis privadas

Na Vercel, abra o projeto da loja e vá a **Settings → Environment Variables**. Cadastre os valores no ambiente Production (e Preview apenas se ele usar um banco separado para testes):

| Nome | Valor |
| --- | --- |
| `DB_HOST` | Endereço do MySQL, sem `https://` |
| `DB_PORT` | Porta do MySQL, normalmente `3306` |
| `DB_NAME` | Nome do banco |
| `DB_USER` | Usuário do banco |
| `DB_PASSWORD` | Senha do banco |
| `DB_SSL_CA` | Opcional quando `certs/aiven-ca.crt` está incluído: o servidor usa esse certificado automaticamente. Para outro banco, informe o caminho do certificado CA do provedor disponível no runtime. |
| `ADMIN_USERNAME` | Nome de usuário escolhido, de 3 a 50 letras, números, pontos, hífens ou sublinhados |
| `ADMIN_PASSWORD` | Senha exclusiva com pelo menos 12 caracteres |
| `APP_SECRET` | Segredo aleatório com pelo menos 32 caracteres |
| `PUBLIC_BASE_URL` | `https://vemariotica.online` |
| `ANALYTICS_RETENTION_DAYS` | `90` |
| `BLACKCAT_API_KEY` | Opcional: chave privada do gateway, somente se for usá-lo |

Não coloque esses valores no GitHub, em arquivos JavaScript ou em mensagens públicas. Não existe senha administrativa padrão. A conta será criada no primeiro acesso à API, se o banco ainda não tiver administradores.

## 3. Publicar e conferir

1. Use o repositório `pollmiix/oculos`, branch `main`, raiz do projeto `.` e Framework Preset **Other**. Não configure uma saída estática que remova a pasta `api`.
2. Depois de cadastrar as variáveis, faça **Redeploy**. Variáveis novas precisam de uma nova implantação para valer.
3. Abra `/api/health`: deve retornar JSON com `ok: true` e `adminConfigured: true`. Erro 503 indica configuração ou conexão incompleta; erro 404 indica que a função/rota não foi publicada.
4. Abra `/admin.php` e entre com `ADMIN_USERNAME` e `ADMIN_PASSWORD`.
5. No painel, confira os produtos e estoque e salve o catálogo para gravá-lo no MySQL.
6. Configure chave PIX, nome do beneficiário e cidade na área de pagamento do painel e salve novamente. A API PHP sozinha não preenche dados bancários.

Mudar `ADMIN_PASSWORD` nas variáveis depois de criar a conta não altera a senha já gravada no banco. Configurações, pedidos e contas de outra hospedagem não são transferidos automaticamente.

## Referências

- Runtime PHP: https://github.com/vercel-community/php
- Configuração da Vercel: https://vercel.com/docs/project-configuration
