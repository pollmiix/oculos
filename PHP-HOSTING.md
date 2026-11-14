# Publicação em hospedagem PHP/MySQL

Para usar o painel e a loja com este backend, publique os arquivos do projeto em uma hospedagem com PHP 8.1 ou superior, Apache com `mod_rewrite`, MySQL/MariaDB e PDO MySQL. O gateway BlackCat também requer a extensão cURL do PHP. Para a Vercel, use o caminho específico de [VERCEL-PHP.md](VERCEL-PHP.md).

## Configuração

1. Crie um banco MySQL e um usuário com permissões nesse banco pelo painel da hospedagem.
2. Copie `config.local.example.php` para `config.local.php` e informe host, nome de banco, usuário e senha do MySQL. Gere `app_secret` com pelo menos 32 caracteres aleatórios e defina uma senha administrativa forte, com pelo menos 12 caracteres. Não use a senha curta que foi usada no servidor local.
3. Se for habilitar a BlackCat, coloque a chave privada em `blackcat_api_key`. Não cadastre chaves privadas em `js/config.js` nem no GitHub.
4. Envie os arquivos do site, incluindo `api.php`, `store-config.php` e `.htaccess`, para a raiz pública configurada no domínio. Envie `config.local.php` pelo gerenciador de arquivos ou crie-o no servidor; ele está ignorado pelo Git. Preencha `public_base_url` com o domínio HTTPS definitivo para gerar os links do feed.
5. Acesse `https://seu-dominio/api/health`. Se a configuração estiver correta, a resposta JSON informará `ok: true`. Depois, abra `https://seu-dominio/admin.php` e entre como o usuário definido em `admin_username`.

As tabelas são criadas automaticamente na primeira chamada à API. A conta proprietária também é criada nessa inicialização quando o banco ainda não contém administradores. Guarde `config.local.php` fora de backups públicos e não compartilhe suas credenciais.

O painel e as páginas continuam servidos no mesmo domínio para evitar configuração de CORS. Depois de entrar pela primeira vez, salve o catálogo pelo painel para sincronizá-lo ao MySQL; pedidos não poderão ser registrados antes dessa sincronização. O banco MySQL começa vazio: dados antigos de pedidos no SQLite local não são importados automaticamente. Faça primeiro uma validação com pedido de teste e credenciais de teste do gateway, quando disponíveis.

No PIX manual, o pedido é registrado como pendente no momento em que o código é gerado. O painel autenticado mostra os dados do cliente, os produtos, o total, o QR Code e o código Copia e Cola. A opção “Já paguei” atualiza esse mesmo pedido para pagamento informado, sem criar outro. O backend recalcula os preços pelo catálogo sincronizado e confere o valor, o identificador e o CRC do payload PIX. A coluna usada para armazenar o código é adicionada automaticamente também em bancos que já têm a tabela `orders`.

O feed XML público de produtos para o Google Merchant Center fica em `https://vemariotica.online/merchant-feed.xml`. Ele é montado a partir do catálogo sincronizado no painel, portanto salvar alterações de produtos atualiza o conteúdo que o Google consulta. Os links individuais levam a `produto.html?id=...`.

A proteção contra excesso de tentativas guarda temporariamente no MySQL um HMAC do endereço de conexão, não o endereço IP em texto aberto. Esses registros servem apenas à limitação de requisições e não são enviados às métricas de navegação. Quando a primeira conta proprietária é criada, trocar `admin_password` no arquivo de configuração não altera a senha existente; uma troca deve ser feita pelo mecanismo de administração do banco ou com uma ferramenta segura no servidor.
