#!/usr/bin/env bash
#
# 飞书 CLI 安装脚本 (第 1 步)
# 详见 docs/feishu-cli-setup.md
#
# 该脚本只负责安装 CLI 本体与 SKILL。
# 配置凭证 (config init) 与登录授权 (auth login) 需要浏览器，请按文档手动完成。

set -euo pipefail

echo "==> 检查 Node.js / npm ..."
if ! command -v npm >/dev/null 2>&1; then
  echo "错误: 未检测到 npm。请先安装 Node.js (含 npm/npx): https://nodejs.org/" >&2
  exit 1
fi
node --version
npm --version

echo "==> 安装 CLI 本体 (@larksuite/cli) ..."
npm install -g @larksuite/cli

echo "==> 安装 CLI SKILL (需能访问 open.feishu.cn) ..."
npx -y skills add https://open.feishu.cn --skill -y

echo "==> 校验安装 ..."
lark-cli --version

cat <<'EOF'

✅ CLI 本体与 SKILL 安装完成。

接下来请手动完成授权 (需要浏览器):

  1. 配置凭证:  lark-cli config init --new      # 打开输出的验证 URL
  2. 登录授权:  lark-cli auth login --recommend # 打开授权链接并点同意
  3. 验证状态:  lark-cli auth status

EOF
