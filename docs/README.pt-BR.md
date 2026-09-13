# CodexRouter

[English](../README.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md)

Um gateway local para usar vários perfis isolados do ChatGPT com o Codex, mantendo um único modelo `CodexRouter` no seletor nativo.

## Download

Baixe o app macOS na página de [GitHub Releases](https://github.com/cesarfavero/codexrouter/releases). Escolha o DMG da arquitetura do seu Mac, arraste para Applications e abra. O Codex CLI oficial precisa estar instalado separadamente.

## Instalação pelo código-fonte

Requisitos: macOS 13+, Node.js 20+ e Codex CLI no `PATH`.

```bash
git clone https://github.com/cesarfavero/codexrouter.git
cd codexrouter
npm install
npm run desktop:dev
```

Na primeira execução, adicione suas contas, conclua o login oficial no navegador, atualize o catálogo, escolha o modelo nativo e o effort em **Settings**, e então clique em **Install & start**.

## Como funciona

Cada conta usa um `CODEX_HOME` isolado. O gateway consulta o uso e troca automaticamente para outra conta configurada quando a conta ativa atinge o limite ou fica com pouco uso restante. As assinaturas não são combinadas em uma única cota.

O app permite escolher o modelo nativo e o reasoning effort padrão (`minimal`, `low`, `medium`, `high` ou `xhigh`). Um effort informado diretamente na requisição tem prioridade.

## Atualizações e segurança

O CodexRouter informa quando uma nova versão está disponível no GitHub Releases. Tokens, cookies e arquivos `auth.json` permanecem locais; o gateway escuta apenas em `127.0.0.1`.

Veja a documentação completa em [README.md](../README.md). Licença MIT.

O código pode ser copiado e modificado conforme a licença MIT, desde que os avisos sejam preservados. Forks e versões modificadas não podem usar o nome ou logo CodexRouter para parecerem oficiais, nem remover os avisos de licença e atribuição. Consulte [`TRADEMARKS.md`](../TRADEMARKS.md).
