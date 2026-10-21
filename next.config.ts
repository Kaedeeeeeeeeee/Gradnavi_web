import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 自托管：生成最小化的独立运行包，供 Docker 镜像使用
  output: "standalone",
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
