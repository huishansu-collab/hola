# 飞书 CLI 安装与配置指南

[飞书 CLI](https://open.feishu.cn/document/no_class/mcp-archive/feishu-cli-installation-guide.md)
（`@larksuite/cli`，命令名 `lark-cli`）是飞书官方提供、面向 AI Agent 的命令行工具，
让 AI 能够直接读写飞书文档、多维表格、日历、邮件、发消息等能力。

> ⚠️ 请在**你自己的电脑**上执行本指南。授权步骤需要在浏览器中人工完成，
> 且需要能正常访问 `open.feishu.cn`。在受限网络环境（如封禁飞书域名的 CI/云容器）中无法完成配置。

## 环境要求

开始之前，请确保本机已安装：

- **Node.js（含 npm / npx）** —— 必需，CLI 以 npm 包形式分发。
- **Go v1.23+ 和 Python 3** —— 仅在你需要从源码构建时才需要；用 npm 直接安装则不需要。

检查 Node 是否就绪：

```shell
node --version   # 应为较新的 LTS 版本
npm --version
```

## 第 1 步 · 安装

```shell
# 安装 CLI 本体
npm install -g @larksuite/cli

# 安装 CLI SKILL（必需，告诉 Agent 如何使用这些命令）
npx -y skills add https://open.feishu.cn --skill -y
```

安装完成后可确认命令可用：

```shell
lark-cli --version
```

## 第 2 步 · 配置应用凭证

在[飞书开放平台](https://open.feishu.cn)创建或选择一个应用，然后运行：

```shell
lark-cli config init --new
```

该命令会阻塞并输出一个 **验证 URL**。在浏览器中打开该 URL 完成应用凭证配置。

## 第 3 步 · 登录

```shell
lark-cli auth login --recommend
```

运行后会得到一个 **授权链接**，在浏览器打开并点击「同意」，CLI 才能拿到访问令牌。

## 第 4 步 · 验证

```shell
lark-cli auth status
```

成功时会返回已配置、已授权的状态；未配置时会返回类似：

```json
{ "ok": false, "error": { "type": "config", "subtype": "not_configured" } }
```

## 常用命令速览

安装并授权后，可通过内置帮助浏览能力：

```shell
lark-cli <domain> --help                       # 浏览某个域下的命令，如 im / docs / sheets / base
lark-cli schema <service>.<resource>.<method>  # 查看某个 API 方法的参数、类型、权限
lark-cli api GET /open-apis/calendar/v4/calendars   # 原始 API 逃生舱：按 HTTP path 调任意端点
```

可用域包括：`application` `approval` `attendance` `base`（多维表格）`calendar`
`contact`（通讯录）`docs` `drive` `event` `im`（消息/群）`mail` `markdown`
`mindnotes` `minutes` `note` `okr` `sheets` 等。

更多能力见官方文档：
[飞书 CLI：给 Agent 一双操作飞书的手](https://open.larkoffice.com/document/mcp_open_tools/feishu-cli-let-ai-actually-do-your-work-in-feishu.md)

## 一键脚本

本仓库提供了 [`scripts/install-feishu-cli.sh`](../scripts/install-feishu-cli.sh)，
封装了第 1 步的安装。授权（第 2、3 步）仍需你在浏览器中手动完成：

```shell
bash scripts/install-feishu-cli.sh
```
