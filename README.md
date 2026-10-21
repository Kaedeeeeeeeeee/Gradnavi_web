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
- 服务启动时会自动执行数据库迁移。
- 改了 `src/db/schema.ts` 之后运行 `npm run db:generate` 生成迁移文件并提交（CI 会检查）。

常用命令：`npm run lint`、`npm run typecheck`、`npm run build`、`npm run db:studio`。

## 部署

一台 2 核 4G 的东京/香港云服务器，跑 Caddy（自动 HTTPS）+ web + Postgres。

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

生产环境必须配置 `SMTP_URL`，否则无法发送验证码。

## 目录

```
src/app/            页面与 API（(app)/ 下为登录后页面）
src/app/api/auth/   Better Auth 接口
src/db/             Drizzle schema、连接、启动迁移
src/lib/            认证、邮件、环境变量
src/proxy.ts        未登录访问工作台时跳转登录页
drizzle/            SQL 迁移文件
deploy/             生产 docker compose 与 Caddyfile
```
