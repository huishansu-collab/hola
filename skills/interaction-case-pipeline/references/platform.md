# 仓库、平台与交付

先从工作目录识别项目。当前兼容入口包括 package.json 中的 case:id、case:validate、case:build、build:local；没有这些入口时读取实际项目文档适配，不臆造 publish、submit 或 approve 命令。

当前示例命令：

```sh
npm run case:id --silent
npm run case:validate -- case-packages/<目录>
npm run case:build -- case-packages/<目录>
```

尖括号为用户实际目录。生成的新 ID 同时写入 manifest 与标准数据，不能每次构建都再执行 id 覆盖。

源包 build 产物包括 runtime.json、clips/、audio.wav、case.json、peaks.json、<id>.case.json 和 <id>.tar。原始包与生成产物分开。通过通用导入器接入，不为每个新 Case 增加专用 TS 数据文件或标题分支。

网站 Files 支持 `.case.json`、标准源包 ZIP 以及从详情导出的 snapshot ZIP。相同 ID 更新；新 ID 增加到目录。源包 ZIP 的 manifest.json 置于根目录。当前单包最大 64 MB、解压后 256 MB/1,000 文件，拒绝非法路径与不一致数据。

当前六个 Case 的详情 ZIP 保存完整标准 JSON、轨道、对白说明、引用的语音和等待音效、已有时的角色双声道合成音频。可用源包放 source/，含母带、alignment、请求正文和说明。传统 Case 仅有片段时明确写明制作历史缺失，不伪造。

双声道合成目标：非助手对白在左声道，助手在右声道。等待音效独立保留为资产和时序；合成对白 WAV 默认不混入等待提示音。确认含第三方角色时按项目角色映射保持非助手左声道。

音频预览 TAR 保留最终 audio.wav 与完整 case.json。完整 ZIP 用于备份、修改和迁移。下载后确认包内音频、说明、ID 与当前 Case 对应。

`npm run build:local` 更新本地独立页面和源码包。是否打开页面、修改项目文件、发布服务器，按用户任务范围和既有授权判断。云端团队用户、发布、审核及资源池需实际后端能力；未接入时交付本地产物与真实状态。

团队复用时将本 Skill 文件夹提供给 Codex 或 Claude Code 的技能目录。所有内部引用为相对路径，服务认证由各使用者单独配置，个人凭据与缓存不随包分发。

## 脚本确认后的默认 ZIP 交付

用户确认脚本并同意开始生成后，完成音频、对齐和校验再交付 `case.zip`。用户只提出修改时保持脚本阶段，不提前生成。提供凭据本身不算脚本确认。

对于当前 source/1 源包，可使用本 Skill 的打包入口，它先通过仓库 CLI 重新构建，再收集当前源包、母带、生成请求、切点、片段、双声道 WAV、波形及完整 JSON：

```sh
python3 /path/to/interaction-case-pipeline/scripts/package_case.py --repo /path/to/project --case /path/to/source-case --output /path/to/case-output/case.zip
```

包以源 manifest.json 为根，因此可直接从网站 Files 导入。description、script 和请求正文保留；私有凭据、原始 API 响应、缓存、旧 ZIP 不进入包。当前 source/1 不支持的音效映射必须先适配，或使用已验收的平台 snapshot ZIP 路径，不宣称语音包包含未接入的非语音资产。

核对 ZIP 可读取、必要文件齐全且对应当前版本，再提供真实下载链接。失败时说明缺失环节并保留草稿，不能给空包、占位链接或标为完成。另行要求导入网站或发布服务器时才执行对应步骤。
