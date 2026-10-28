# Publicacao automatica da loja

O publicador acompanha esta pasta enquanto o Windows estiver ligado. Depois de 15 segundos sem novos salvamentos, cria um commit e envia as alteracoes para `pollmiix/oculos`, branch `main`. A integracao existente da Vercel inicia o deploy. O deploy ainda precisa terminar antes de a alteracao aparecer na loja.

O publicador respeita `.gitignore` e exclui arquivos `.env`, configuracao privada local, chaves, bancos, certificados e pastas internas. Novos arquivos publicos tambem podem ser enviados. Nao coloque senhas nos arquivos da pagina ou do JavaScript.

- Iniciar: execute `INICIAR-PUBLICACAO.ps1` com PowerShell.
- Parar nesta sessao: execute `PARAR-PUBLICACAO.ps1`.
- Consultar resultado: abra `.auto-publish/status.json` ou `.auto-publish/publish.log`.
- Desabilitar no proximo login: remova somente o atalho `Loja Oculos - Publicacao automatica` da pasta que abre com `shell:startup` no Windows.

E necessario manter esta pasta, o Python em `.venv` e o login do GitHub usado pelo Gerenciador de Credenciais do Git. Se houver conflito, branch diferente de `main`, alteracoes preparadas manualmente ou falha de autenticacao, o publicador registra o problema e aguarda; nunca faz push forcado. A verificacao de conflitos usa o Git normalmente, podendo deixar arquivos de merge para resolucao manual.
