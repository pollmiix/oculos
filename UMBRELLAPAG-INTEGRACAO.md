# UmbrellaPag: Pix na Vercel

A troca é ativada pelo painel depois que a conta é verificada. Publicar o código não muda automaticamente o gateway dos pedidos novos. Cobranças anteriores continuam sendo consultadas na BlackCat; mantenha `BLACKCAT_API_KEY` enquanto houver pagamentos antigos pendentes.

## Configurar

1. No painel da UmbrellaPag, encontre ou gere a chave de API para a sua conta. O endereço `https://api-gateway.umbrellapag.com/api` é a URL da API, não uma chave. Se a opção não estiver disponível, peça ao suporte da UmbrellaPag a liberação da API e das cobranças Pix.
2. Na Vercel, abra o projeto conectado a este repositório e vá a **Settings → Environment Variables**. Adicione `UMBRELLAPAG_API_KEY` no ambiente **Production**, usando o valor privado da chave. Não use prefixo público nem grave a chave no GitHub ou no JavaScript.
3. Preserve `APP_SECRET` com pelo menos 32 caracteres e `PUBLIC_BASE_URL=https://vemariotica.online`. Mudar `APP_SECRET` invalida os tokens de notificações já emitidos.
4. Publique esta versão do código e faça **Redeploy** depois de adicionar a variável.
5. Acesse `https://vemariotica.online/admin.php`, entre na conta proprietária, abra **Gateway** e clique em **Verificar conexão**. Essa operação consulta a conta, sem criar cobranças.
6. Confira o nome da empresa retornado e clique em **Ativar Pix automático**. Novos pedidos passarão a usar a UmbrellaPag. A ativação exige que a conta não esteja bloqueada, que Pix esteja liberado e que o catálogo esteja publicado.
7. Valide a geração do QR Code, o Pix Copia e Cola e a confirmação de um pagamento antes de considerar a troca concluída.

## Teste pelo painel

O formulário **Testar QR Code UmbrellaPag** cria uma cobrança real de R$ 1 a R$ 100, somente após a confirmação na tela. Pagar movimenta dinheiro e pode gerar taxas. Esses testes não entram nos pedidos de produtos ou no estoque. Cada envio reserva um identificador no banco antes da chamada; repetir esse identificador não gera outra cobrança. Após perda de resposta, consulte o teste existente antes de iniciar outro.

## Confirmação dos pedidos

O servidor calcula valores pelo catálogo e envia somente Pix. A URL de notificação é enviada automaticamente em `postbackUrl`, com um token por cobrança. Os endpoints são `/api/webhooks/umbrellapag` e `/api/webhooks/umbrellapag-test`; não cadastre uma URL sem os parâmetros gerados pelo servidor. O status enviado no webhook não confirma o pagamento: o servidor consulta a transação na UmbrellaPag e confere ID, método, moeda e valor antes de atualizar o pedido. A confirmação pelo botão do checkout faz a mesma verificação.

Os dados de Pix são normalizados para o checkout existente. A documentação pública não traz um exemplo completo de resposta Pix aprovada; é necessário validar os campos retornados pela conta real, sem compartilhar credenciais, antes de ativar vendas. Os testes locais usam respostas simuladas e não comprovam a liberação da conta na UmbrellaPag.

Esta integração está no backend PHP usado pela Vercel. O servidor Python de desenvolvimento continua com a integração anterior e não deve ser usado para validar a UmbrellaPag.

## Referências oficiais

- [Introdução, URL e User-Agent](https://docs.umbrellapag.com/-introdu%C3%A7%C3%A3o-%C3%A0-api-1348891m0)
- [Criar transação](https://docs.umbrellapag.com/create-20025744e0)
- [Consultar transação](https://docs.umbrellapag.com/find-by-id-20025745e0)
- [Formato do webhook](https://docs.umbrellapag.com/%EF%B8%8F-webhook-formato-de-postback-1348893m0)
