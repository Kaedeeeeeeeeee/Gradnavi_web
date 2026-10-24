# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:worker

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# PDF 导出用的 Chromium（日文字体随应用打包，见 src/server/pdf.ts）
RUN apk add --no-cache chromium
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
# 定时任务 worker（同一镜像，compose 里用 node worker.mjs 启动）
COPY --from=build --chown=app:app /app/dist/worker.mjs /app/dist/worker.mjs.map ./
# 把扫描版 PDF 转成图片用的原生画布模块（worker 和聊天都用；Next 的 standalone 包里不全）
COPY --from=build --chown=app:app /app/node_modules/@napi-rs ./node_modules/@napi-rs
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
