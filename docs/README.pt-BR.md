# CodexRouter

[English](../README.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md)

Um gateway local para usar vários perfis isolados do ChatGPT com o Codex, mantendo todos os modelos nativos e aliases por conta no seletor.

## Download

Baixe o app na página de [GitHub Releases](https://github.com/cesarfavero/codexrouter/releases). No macOS, escolha o DMG da arquitetura do seu Mac e arraste para Applications. No Windows, baixe o instalador x64. O Codex CLI oficial precisa estar instalado separadamente.

O app instalado no Windows consulta novas versões no GitHub Releases. Quando houver uma atualização, ele mostra uma ação para baixar e reiniciar após o seu clique.

## Instalação pelo código-fonte

Requisitos: macOS 13+, Node.js 20+ e Codex CLI no `PATH`.

```bash
git clone https://github.com/cesarfavero/codexrouter.git
cd codexrouter
npm install
npm run desktop:dev
```

Na primeira execução, adicione suas contas, conclua o login oficial no navegador, atualize o catálogo, escolha o modelo nativo e o effort em **Settings**, e então clique em **Install & start**.

Se um modelo novo não aparecer no Windows, abra **Gateway** para conferir os modelos e o resultado da última atualização do catálogo. Use **Refresh gateway** após atualizar o Codex CLI oficial. Para que o catálogo apareça no seletor do Codex, a integração em **Setup** precisa estar instalada; reinicie o Codex depois de instalá-la. Os modelos disponíveis podem variar conforme a conta ativa.

## Como funciona

Cada conta usa um `CODEX_HOME` isolado. O gateway consulta o uso e troca automaticamente para outra conta configurada quando a conta ativa atinge o limite ou fica com pouco uso restante. As assinaturas não são combinadas em uma única cota.

O app permite escolher o modelo nativo e o reasoning effort padrão (`minimal`, `low`, `medium`, `high` ou `xhigh`). Um effort informado diretamente na requisição tem prioridade.

## Atualizações e segurança

O CodexRouter informa quando uma nova versão está disponível no GitHub Releases. Tokens, cookies e arquivos `auth.json` permanecem locais; o gateway escuta apenas em `127.0.0.1`.

Veja a documentação completa em [README.md](../README.md). Licença MIT.

O código pode ser copiado e modificado conforme a licença MIT, desde que os avisos sejam preservados. Forks e versões modificadas não podem usar o nome ou logo CodexRouter para parecerem oficiais, nem remover os avisos de licença e atribuição. Consulte [`TRADEMARKS.md`](../TRADEMARKS.md).
