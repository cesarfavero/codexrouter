# CodexRouter

[English](../README.md) · [Português](README.pt-BR.md) · [简体中文](README.zh-CN.md)

CodexRouter 是一个本地网关，可在 Codex 中管理多个相互隔离的 ChatGPT 账户，同时只显示一个原生模型：`CodexRouter`。

## 下载

请从 [GitHub Releases](https://github.com/cesarfavero/codexrouter/releases) 下载 macOS 应用。选择与你的 Mac 架构匹配的 DMG，将 CodexRouter 拖到 Applications 后打开。官方 Codex CLI 需要单独安装。

## 从源码安装

要求：macOS 13+、Node.js 20+，并且 Codex CLI 已加入 `PATH`。

```bash
git clone https://github.com/cesarfavero/codexrouter.git
cd codexrouter
npm install
npm run desktop:dev
```

首次运行时添加账户，在浏览器中完成官方登录，刷新模型目录，在 **Settings** 中选择原生模型和 effort，然后点击 **Install & start**。

## 工作方式

每个账户都有独立的 `CODEX_HOME`。当当前账户达到额度或剩余额度较低时，网关会自动切换到另一个已配置且健康的账户。不同订阅不会合并成一个额度池。

你可以为账户设置原生模型和默认 reasoning effort（`minimal`、`low`、`medium`、`high` 或 `xhigh`）。请求中明确提供的 effort 优先级更高。

## 更新与安全

当 GitHub Releases 发布新版本时，CodexRouter 会提示有可用更新。Token、Cookie 和 `auth.json` 始终保存在本地；网关只监听 `127.0.0.1`。

完整文档请参阅 [英文 README](../README.md)。许可证：MIT。
