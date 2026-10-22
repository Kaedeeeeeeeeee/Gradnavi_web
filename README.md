# GradNavi 修考工作台

AI 时代的修考工作台：帮助留学生从决定去日本读研一路走到入学。产品与技术文档见项目共享目录 `product/`。

技术栈：Next.js（App Router）+ TypeScript、Tailwind CSS、PostgreSQL + Drizzle ORM、Better Auth（邮箱验证码登录），Docker Compose 自托管。

## 本地开发

```bash
cp .env.example .env
docker compose up -d   # 启动本地 Postgres
npm install
npm run dev            # http://localhost:3000
```

- 未配置 `SMTP_URL` 时，登录验证码会打印在 `npm run dev` 的终端里。
- 未配置 `DEEPSEEK_API_KEY` 时，AI 侧边栏使用演示模型（固定回复，不花钱）：发送「记住：……」会写入 user.md，「待办：……」会添加 Todo，「找教授：关键词」会返回示例教授，用来测试工具调用链路；找教授页面也返回明确标注的示例数据。
- 「日程：2026-12-01 标题」会添加一条日程。
- 定时任务（募集要项监控）是单独的进程：另开终端运行 `npm run worker`（先打包成 `dist/worker.mjs` 再启动）。没有 key 时只做页面变化检测，不解析日程。
- 服务启动时会自动执行数据库迁移。
- 改了 `src/db/schema.ts` 之后运行 `npm run db:generate` 生成迁移文件并提交（CI 会检查）。

常用命令：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run db:studio`。

## 部署

一台 2 核 4G 的东京/香港云服务器，跑 Caddy（自动 HTTPS）+ web + worker（定时任务，同一镜像）+ Postgres。

1. **CI**：每个 PR 跑 lint、类型检查、迁移检查和构建；合并到 `main` 后自动构建镜像推送到 `ghcr.io/kaedeeeeeeeeee/gradnavi_web`。
2. **服务器首次准备**（买好服务器、域名解析到服务器 IP 之后）：
   ```bash
   # 安装 Docker 后
   mkdir ~/gradnavi && cd ~/gradnavi
   # 把仓库里的 deploy/docker-compose.yml 和 deploy/Caddyfile 放到这里
   # 参照 .env.example 写 .env：POSTGRES_PASSWORD、BETTER_AUTH_SECRET、BETTER_AUTH_URL、SMTP_URL、MAIL_FROM、DOMAIN
   docker login ghcr.io    # 镜像是私有的，用 GitHub 用户名 + 有 read:packages 权限的 token
   docker compose up -d
   ```
3. **后续发布**：在 GitHub Actions 里手动运行 `Deploy` 工作流（需要仓库 Secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`）。

生产环境必须配置 `SMTP_URL`，否则无法发送验证码和募集要项更新通知。

## 募集要项监控

- 用户在「目标研究科」页（或让 AI）关注研究科，填该研究科入试 / 募集要项页面的网址。研究科跨用户共享，同一研究科每天只查一次。
- worker（`src/worker/index.ts`，pg-boss）每天 4:00（日本时间）检查全部被关注的研究科，另外每 5 分钟处理新关注和“立即检查”的。
- 每次检查先直接抓页面，只对入试相关的行和链接算指纹（`src/lib/admissions.ts`）；没变化就结束，不花钱。变了才调用一次 AI 抽取日程（页面没日期时再读一次要项 PDF），日程有变化才邮件 + Todo 通知关注的用户。系统任务，不扣用户 credit。
- 日历里：最新要项的日程都已过去时，整体顺延一年显示为“仮・基于 X 年度”；新年度要项解析出来后自动变成正式日程。

## Credit 计量

- 每个用户一个余额（`credit_account`），每次变动记一笔流水（`credit_ledger`：注册赠送 / 管理员发放 / 使用；以后接 Stripe 用 `topup` + `external_ref`）。第一次用到时开户并发放 `SIGNUP_CREDITS`。
- 计费的操作：AI 对话（`/api/chat`，含对话里的找教授、联网检索、读网页工具）、找教授页面检索。开始前余额必须 > 0，结束后按实际用量扣（`src/server/credits.ts`）。
- 每次操作的 token、检索/抓取次数、**我们付出的成本（美元）** 和扣的 credit 记在 `ai_usage`；募集要项监控也记成本，但 `user_id` 为空、不扣 credit。
- 成本 = token × 价格表 + 检索/抓取次数 × 单价，credit = ⌈成本 × `CREDITS_PER_USD` × `CREDIT_MARKUP`⌉。价格都在环境变量里（见 `.env.example`），核对 DeepSeek 账单后直接改。
- 用户在「credit」页看余额和使用记录；`ADMIN_EMAILS` 里的邮箱在 `/admin` 看成本统计（今天 / 7 天 / 全部、按功能、按用户、逐条调用）、发 credit。

## 内测

- `SIGNUP_MODE=invite`：只有 `/admin` 邀请名单里的新邮箱（和 `ADMIN_EMAILS`）能收到验证码注册；已注册用户不受影响。`open` 为开放注册。
- 顶栏「反馈」页收集反馈，在 `/admin` 查看。

## AI 工具

用户能做的事 AI 也能做：读写逻辑都在 `src/server/`，页面的 server action 和 AI 工具调用同一套函数。
新增工具：在 `src/lib/ai/tools/` 用 `defineTool` 定义 → 加进 `tools/index.ts` 的 `ALL_TOOLS` → 在 `src/lib/ai/tool-meta.ts` 登记中文名。
每次工具调用都记录在 `ai_tool_call` 表。

## 界面样式

Notion 式：白底、暖灰字、边框很淡、几乎不用阴影，靠留白和字号分层。颜色和共用组件都在 `src/app/globals.css`：
- 颜色只用语义 token（`text-muted`、`text-faint`、`border-line`、`border-line-strong`、`bg-subtle`、`bg-panel`、`bg-primary` + `text-on-primary`、`text-accent`、`info` / `ok` / `warn` / `danger` 及 `-soft` 底色），不直接写 `zinc-500` 这类色值，也不写 `dark:` 颜色类；深色模式只在 token 里换值。
- 圆角一套：小标签 `rounded`（4px），按钮和输入框 8px，卡片、列表框、三栏面板 `rounded-xl`（12px）；三栏是浮在浅灰底板（`bg-canvas`）上的圆角面板。
- 主页这类信息多的页面按板块分：`card`（容器）+ `card-head`（标题栏，`card-title`）+ 可选 `card-foot`（底部操作）。
- 按钮 `btn` / `btn-primary` / `btn-ghost`，输入框 `input`，页面标题 `page-title`，分组小标题 `section-title`；尺寸用 `px-` / `py-` / `text-` 覆盖。

## 目录

```
src/app/            页面与 API（(app)/ 下为登录后页面）
src/app/api/auth/   Better Auth 接口
src/db/             Drizzle schema、连接、启动迁移
src/app/api/chat/   AI 对话接口（流式输出 + 工具调用 + 对话持久化）
src/components/ai/  AI 侧边栏
src/lib/ai/         模型配置、系统提示、工具注册表（tools/）
src/lib/            认证、邮件、环境变量、引导问卷、「下一步」流程任务规则
src/server/         数据读写（user.md、Todo、日历、文书、教授、研究科），页面操作和 AI 工具共用
src/worker/         定时任务进程（打包为 dist/worker.mjs）
src/proxy.ts        未登录访问工作台时跳转登录页
drizzle/            SQL 迁移文件
deploy/             生产 docker compose 与 Caddyfile
```
