# Integracao PinguPag

1. Configure PINGUPAG_API_KEY nas variaveis privadas do servidor. Nunca coloque a chave no navegador ou no repositorio.
2. Configure APP_SECRET com pelo menos 32 caracteres e PUBLIC_BASE_URL com a URL HTTPS publica da loja.
3. Publique os arquivos e reinicie ou faca redeploy.
4. No painel, em Gateway, selecione gateway, verifique a conexao e ative o Pix automatico.
5. Valide a criacao e a confirmacao de uma cobranca com a conta PinguPag antes de usar em vendas.

O webhook e informado por transacao; o servidor confirma status, identificador, referencia e valor consultando a API. Pedidos BlackCat antigos mantem sua consulta.
