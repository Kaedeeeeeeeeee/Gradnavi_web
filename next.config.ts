import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 自托管：生成最小化的独立运行包，供 Docker 镜像使用
  output: "standalone",
  // PDF 导出：puppeteer-core 不打包；日文字体文件按路径读取，需显式带进 standalone 包
  serverExternalPackages: ["puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/documents/\\[id\\]/pdf": [
      "./node_modules/@fontsource/noto-serif-jp/{400,700}.css",
      "./node_modules/@fontsource/noto-serif-jp/files/*-{400,700}-normal.woff2",
    ],
  },
  // 读字体目录会让追踪把整个字体包（约 100MB，所有字重）带进来，只留上面两个字重
  outputFileTracingExcludes: {
    "/api/documents/\\[id\\]/pdf": [
      "./node_modules/@fontsource/noto-serif-jp/files/*.woff",
      "./node_modules/@fontsource/noto-serif-jp/files/*-{100,200,300,500,600,800,900}-*",
      "./node_modules/@fontsource/noto-serif-jp/scss/**",
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
