# Notion-Game 同步

这是一个 Node.js 脚本，可将您的 Steam 游戏库同步到 Notion 数据库。它会自动从 Steam API 获取您拥有的游戏、游戏时间和成就完成率，并保持您的 Notion 数据库更新。

## 功能

- **同步 Steam 库:** 获取您在 Steam 上拥有的所有游戏。
- **Notion 集成:** 在您的 Notion 数据库中为每个新游戏创建一个新页面。
- **更新游戏统计:** 使用最新的游戏时间和成就完成率更新现有的游戏页面。
- **高效同步:** 仅更新已更改的游戏，最大限度地减少 API 调用。
- **弹性设计:** 优雅地处理 API 错误而不会崩溃。

## 工作原理

该脚本执行以下步骤：

1.  **获取 Steam 游戏:** 从 Steam API 检索您拥有的所有游戏的列表，包括它们的 App ID、名称和总游戏时间。
2.  **获取 Notion 数据库:** 从您指定的 Notion 数据库中检索所有现有的游戏条目。
3.  **比较和同步:**
    *   如果您 Steam 库中的游戏在 Notion 中不存在，它将创建一个包含游戏详细信息的新页面。
    *   如果游戏已存在，它会检查游戏时间的变化。如果游戏时间已更改，它将更新游戏时间并刷新成就完成率。
    *   Notion 中的游戏封面图像将设置为 Steam 商店中该游戏的标题图片。

## 先决条件

在开始之前，请确保您拥有以下内容：

-   [Node.js](https://nodejs.org/) (建议使用 v16 或更高版本)
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
    *   本项目并没有生成数据库的方法，可以在 [这里](https://www.notion.so/yuecheng/245e106bbeb18007b8ddca60e5540373?v=245e106bbeb18126b268000cc1e83359&source=copy_link) 复制一份模版

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

| 属性名称 | 类型 | 描述 |
| --- | --- | --- |
| `name` | `Title` | 游戏名称。 |
| `appid` | `Number` | 游戏的 Steam App ID。 |
| `play_time` | `Number` | 总游戏时间（分钟）。 |
| `achievement` | `Number` | 成就完成率（0 到 1）。 |

## 贡献

欢迎贡献！如果您有任何建议或发现任何错误，请随时提交拉取请求或开启一个 issue。

---
*该 README 由 Gemini 生成。*
