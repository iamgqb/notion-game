# Notion-Game 同步

这是一个 Node.js 项目，可将 Steam 游戏库同步到 Notion、将业务数据备份到 Cloudflare R2，并把游戏陈列室按需部署到 Cloudflare Workers Static Assets。它会自动从 Steam API 获取游戏、游戏时间和成就完成率，并保持 Notion 数据库和公开展示页面更新。

## 功能

- **同步 Steam 库:** 获取您在 Steam 上拥有的所有游戏。
- **Notion 集成:** 在您的 Notion 数据库中为每个新游戏创建一个新页面。
- **更新游戏统计:** 使用最新的游戏时间和成就完成率更新现有的游戏页面。
- **高效同步:** 仅更新已更改的游戏，最大限度地减少 API 调用。
- **弹性设计:** 优雅地处理 API 错误而不会崩溃。
- **历史记录追踪:** 在一个单独的数据库中记录每天的游戏时间增量。
- **游戏陈列室:** 提供近期游玩、喜欢、全成就、近一个月时间线和完整游戏库页面。
- **按变化部署:** 只有业务数据、站点文件或 Workers 配置实际变化时才创建新的部署。

## 工作原理

该脚本执行以下步骤：

1.  **获取 Steam 游戏:** 从 Steam API 检索您拥有的所有游戏的列表，包括它们的 App ID、名称和总游戏时间。
2.  **获取 Notion 数据库:** 从您指定的 Notion 数据库中检索所有现有的游戏条目。
3.  **比较和同步:**
    *   如果您 Steam 库中的游戏在 Notion 中不存在，它将创建一个包含游戏详细信息的新页面。
    *   如果游戏已存在，它会检查游戏时间的变化。如果游戏时间已更改，它将更新游戏时间并刷新成就完成率。
    *   Notion 中的游戏封面图像将设置为 Steam 商店中该游戏的标题图片。
4.  **记录历史:**
    *   当检测到游戏时间增加时，会在历史数据库中创建一个新条目，记录游戏、增量时间和日期。

## 先决条件

在开始之前，请确保您拥有以下内容：

-   [Node.js](https://nodejs.org/) v24 或更高版本
-   一个 [Notion 帐户](https://www.notion.so/)
-   一个 [Steam 帐户](https://store.steampowered.com/) (个人资料需公开)
-   一个 [Steam API 密钥](https://steamcommunity.com/dev/apikey)

## 设置

1.  **克隆仓库:**
    ```bash
    git clone https://github.com/your-username/notion-game.git
    cd notion-game
    ```

3.  **创建 Notion 集成:**
    *   转到 Notion 中的 [我的集成](https://www.notion.so/my-integrations) 并创建一个新的集成。
    *   给它一个名称（例如，“Steam Sync”）并复制 **内部集成令牌 (Internal Integration Token)**。这将是您的 `NOTION_API_KEY`。
    *   转到您的 Notion 数据库，并与您刚刚创建的集成共享。

4.  **找到您的 Notion 数据库 ID:**
    *   在浏览器中打开您的 Notion 数据库。
    *   URL 看起来像这样: `https://www.notion.so/your-workspace/DATABASE_ID?v=...`
    *   从 URL 中复制 `DATABASE_ID`。
    *   本项目并没有生成数据库的方法，可以在 [这里](https://www.notion.so/yuecheng/245e106bbeb18007b8ddca60e5540373?v=245e106bbeb18126b268000cc1e83359&source=copy_link) 复制一份游戏库模版。
    *   历史数据库模版可以在 [这里](https://www.notion.so/278e106bbeb18004ad12d470de8a1c0d?v=278e106bbeb1811e9ca3000cc94c2341&source=copy_link) 复制。

5.  **找到您的 Steam ID:**
    *   访问 [Steam账户页](https://store.steampowered.com/account/) 复制您的 `steamID64`。

6.  **配置环境变量:**
    *   通过复制 `.env.example` 文件，在项目根目录中创建一个 `.env` 文件：
        ```bash
        cp .env.example .env
        ```
    *   打开 `.env` 文件并填写以下值：
        ```
        NOTION_API_KEY="your_notion_api_key"
        NOTION_DATABASE_ID="your_notion_database_id"
        HISTORY_DATABASE_ID="your_history_database_id"
        STEAM_KEY="your_steam_api_key"
        STEAM_ID="your_steam_id_64"
        ```

## 使用方法

要运行同步脚本，请执行以下命令：

```bash
node src/index.js
```

脚本会将其进度记录到控制台。

## 数据库属性

为使脚本正常工作，您的 Notion 数据库应具有以下属性：

### 游戏库数据库

| 属性名称 | 类型 | 描述 |
| --- | --- | --- |
| `name` | `Title` | 游戏名称。 |
| `appid` | `Number` | 游戏的 Steam App ID。 |
| `play_time` | `Number` | 总游戏时间（分钟）。 |
| `achievement` | `Number` | 成就完成率（0 到 1）。 |
| `buy_time` | `Date` | 游戏购买日期。 |
| `status` | `Multi-select` | 游戏状态标签。 |
| `favorite` | `Checkbox` | 是否收藏；实际字段名使用美式拼写 `favorite`。 |

### 历史数据库

| 属性名称 | 类型 | 描述 |
| --- | --- | --- |
| `name` | `Title` | 游戏名称。 |
| `appid` | `Number` | 游戏的 Steam App ID。 |
| `time` | `Number` | 游戏时间增量（分钟）。 |
| `date` | `Date` | 记录日期。 |

## Cloudflare R2 备份

每日同步结束后，GitHub Actions 会读取游戏库和历史库，并将规范化后的业务数据与 R2 中的最新有效快照比较。只有数据发生变化，或最新快照缺失、损坏时，才会创建完整快照。同步任务即使失败，备份任务仍会运行。

当前备份目标：

- Endpoint：`https://23cbd4dde1f2b9ba631161785549d4b3.r2.cloudflarestorage.com`
- Bucket：`game-record`
- Region：`auto`

游戏库备份 `name`、`appid`、`play_time`、`achievement`、`buy_time`、`status`、`favorite`；历史库备份 `name`、`appid`、`time`、`date`。Formula、页面正文、附件和封面不在备份范围内。

有效快照位于：

```text
snapshots/YYYY/MM/DD/<UTC时间戳>-<内容哈希前12位>/
├── games.json.gz
├── history.json.gz
├── games.csv
├── history.csv
└── manifest.json
```

`manifest.json` 最后写入；没有清单的目录不视为有效快照。每周审计会识别这类未完成前缀，在 Bucket Lock 的 90 天保护期内报告为延期清理，并在 91 天安全宽限期后删除。`state/latest.json` 指向最新快照。最近 90 天内保留所有变更快照，90 天至 12 个月之间每月保留最后一份，最新有效快照始终保留。

备份前会校验两个 Notion 数据库的必需字段名称、类型和值结构。字段被重命名、删除或从 Date/Multi-select/Checkbox 等类型改成其他类型时，任务会直接失败，不会把 schema 漂移静默转换为空值并写入 R2。

### GitHub 配置

在仓库的 `Settings → Secrets and variables → Actions` 中配置：

| 类型 | 名称 | 值或权限 |
| --- | --- | --- |
| Variable | `R2_ACCOUNT_ID` | `23cbd4dde1f2b9ba631161785549d4b3` |
| Variable | `R2_BUCKET` | `game-record` |
| Secret | `R2_ACCESS_KEY_ID` | R2 S3 Access Key ID |
| Secret | `R2_SECRET_ACCESS_KEY` | R2 S3 Secret Access Key |

R2 凭证应选择 `Object Read & Write`，并限制到 `game-record` Bucket。不要把凭证提交到仓库。现有 Notion Secrets 会由备份任务复用。

本地执行：

```bash
npm ci
npm run backup
npm run backup:audit
```

### Bucket 保护规则

保留现有的 `Default Multipart Abort Rule`。在 Cloudflare Dashboard 的 `R2 → game-record → Settings` 中另外配置：

1. Object Lifecycle Rule：名称 `Delete stale staging`，前缀 `staging/`，7 天后删除。
2. Bucket Lock Rule：名称 `Protect snapshots 90 days`，前缀 `snapshots/`，保留 90 天。
3. 不为 `snapshots/` 配置自动过期规则；历史清理由每周审计任务完成，从而保证最新快照不会因长期无变化而过期。

也可以使用已登录且具备 Bucket 管理权限的 Wrangler：

```bash
npx wrangler r2 bucket lifecycle add game-record "Delete stale staging" "staging/" --expire-days 7
npx wrangler r2 bucket lock add game-record "Protect snapshots 90 days" "snapshots/" --retention-days 90
npx wrangler r2 bucket lifecycle list game-record
npx wrangler r2 bucket lock list game-record
```

GitHub Actions 使用的对象级凭证不应拥有修改这些规则的权限。

### 人工恢复

1. 从事故发生前最近的快照下载 `manifest.json` 和其中列出的四个文件，逐项核对文件大小与 SHA-256。
2. 从本项目提供的游戏库和历史库模板分别复制一个新数据库，不要直接覆盖受损数据库。
3. 将 `games.csv` 和 `history.csv` 导入新数据库；确认 `buy_time` 为 Date、`status` 为 Multi-select、`favorite` 为 Checkbox，其余字段类型与上文一致。
4. CSV 中的 `buy_time_end`、`buy_time_time_zone`、`date_end`、`date_time_zone` 用于保留日期范围信息。若实际数据不使用日期范围，可在导入前删除这些空列；否则根据 JSON 快照人工核对范围和时区。
5. 将新数据库共享给 Notion 集成，更新 `NOTION_DATABASE_ID` 和 `HISTORY_DATABASE_ID`。
6. 手动触发一次同步，核对两个数据库的记录数与 `manifest.json` 一致。

建议每季度使用临时 Notion 数据库执行一次完整恢复演练。

### 备份结果

- `CREATED_SNAPSHOT`：业务数据变化，已创建并校验新快照。
- `SKIPPED_NO_CHANGE`：业务数据未变化，且最新快照校验通过；R2 不产生写操作。
- `CREATED_REPAIR_SNAPSHOT`：业务数据未变化，但最新快照损坏或缺失，已重建。
- 每周日运行审计，校验最新快照并执行保留清理；失败会使 GitHub Actions 任务失败并触发通知。

## Cloudflare Workers 游戏陈列室

静态站点源文件位于 `site/`。本地查看真实只读数据：

```bash
npm run site:data
npm run site:serve
```

打开 `http://127.0.0.1:4173`。生成的 `site/data.js` 已加入 `.gitignore`，不会把本地快照提交到仓库。

### 自动部署流程

主工作流中的 Workers 任务会在备份任务结束后执行：

1. 从 R2 的 `state/latest.json` 读取最新有效备份，并校验清单、文件哈希和业务内容哈希。
2. 使用备份中的 `games.json.gz` 与 `history.json.gz` 生成 `site/data.js`，部署过程不会再次请求 Notion。
3. 对最终 `site/` 目录以及 `wrangler.jsonc` 的文件名和文件内容计算 SHA-256。
4. 与 R2 的 `state/workers.json` 比较；哈希一致时返回 `SKIPPED_NO_CHANGE`，不调用 Cloudflare Workers。
5. 只有哈希变化时才执行 `wrangler deploy`；部署成功后才更新 `state/workers.json`。

页面代码、样式、Workers 配置或业务数据任一变化都会触发部署。仅同步时间变化、但业务数据和页面文件不变时不会部署。手动运行 GitHub Actions 时可以勾选 `force_site_deploy` 强制重新部署，用于 Worker 重建或状态恢复。

### 首次配置 Cloudflare Workers

项目使用 **Workers Static Assets**，由仓库根目录的 `wrangler.jsonc` 声明 Worker 名称 `notion-games` 和静态资源目录 `site/`。不需要先在 Cloudflare Dashboard 创建 Pages 项目或 Worker；首次成功执行 `wrangler deploy` 会自动创建应用，后续运行会更新同名 Worker。

1. 在 Cloudflare 的 `API Tokens → Create Token → Custom Token` 创建或更新令牌，权限设置为 `Account → Workers Scripts → Edit`，并限制到当前 Cloudflare 账户。现有 Account API Token 可以同时保留 R2 权限与这项权限。
2. 在 GitHub 仓库 `Settings → Secrets and variables → Actions` 中新增：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 具有 Workers Scripts Edit 权限的 Account API Token |

工作流会复用已有的 `R2_ACCOUNT_ID` 作为 Cloudflare Account ID，并复用 R2 凭证读取备份和记录部署状态。本地 `.env` 不会上传到 GitHub，因此仍需单独保存上述 GitHub Secret。

配置完成后，在 GitHub Actions 手动运行 `Sync Steam Games to Notion`。首次运行应显示 `DEPLOY_REQUIRED`，并创建 `notion-games` Worker 及其 `workers.dev` 地址；再次运行且数据未变化时应显示 `SKIPPED_NO_CHANGE`。

部署成功后如需绑定自定义域名，可在 Cloudflare Dashboard 进入该 Worker 的 `Settings → Domains & Routes`。如果希望通过 API 管理路由，还需要给令牌增加对应 Zone 的 `Workers Routes → Edit` 权限；这不影响默认 `workers.dev` 地址的部署。

Cloudflare 官方参考：[从 Pages 迁移到 Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)、[GitHub Actions 部署](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)、[静态资源计费与限制](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)。

---
*该 README 由 Gemini / Codex 生成。*
