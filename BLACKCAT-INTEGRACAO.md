# BlackCat: Pix na Vercel

A BlackCat foi restaurada como gateway de Pix desta loja. A API usa a URL oficial `https://api.blackcatoficial.com/api`, a chave privada no servidor e valores em centavos. A interface permite somente Pix.

## Configurar e ativar

1. Na Vercel, configure `BLACKCAT_API_KEY` em **Production** com a chave privada da conta BlackCat. Nao compartilhe a chave no chat ou em arquivos publicos. Se essa variavel ainda existir e continuar valida, nao precisa troca-la.
2. Preserve `APP_SECRET` (pelo menos 32 caracteres) e `PUBLIC_BASE_URL=https://vemariotica.online`.
3. Faca **Redeploy** depois de alterar variaveis.
4. No painel `/admin.php`, abra **Gateway**, clique em **Verificar conexao**, confira a empresa e use **Ativar Pix automatico**.
5. O formulario de teste cria um Pix real de R$ 1 a R$ 100 somente apos o consentimento na tela. Gere um teste com seus proprios dados para conferir QR Code e Copia e Cola. Pagar movimenta dinheiro e pode gerar taxas.

A selecao existente da BlackCat pode ser retomada se ainda estiver configurada no banco e a chave estiver presente. O estado publico `/api/health` informa configuracao, mas nao comprova que a chave foi aceita ou que um pagamento foi recebido.

## Confirmacao e historico

O backend valida produtos, precos e estoque antes de criar a cobranca. As notificacoes usam token por pedido e o servidor consulta a BlackCat para conferir ID e valor antes de confirmar pagamento. Os testes administrativos ficam separados dos pedidos e do estoque e usam um identificador para impedir duplicacao em reenvios.

Os pedidos antigos foram preservados. Apenas transacoes registradas como BlackCat podem ser consultadas nessa integracao. Os pedidos de outro provedor continuam no historico e devem ser conferidos diretamente no respectivo painel.

O servidor Python suporta Pix manual. O Pix automatico desta versao usa o backend PHP da Vercel, conforme [VERCEL-PHP.md](VERCEL-PHP.md).

[Documentacao oficial da BlackCat](https://docs.blackcatoficial.com/).
