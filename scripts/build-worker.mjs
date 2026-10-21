// 把定时任务 worker（src/worker/index.ts）打包成单文件 dist/worker.mjs，Docker 镜像里直接 node 运行。
// server-only 包在 Next 之外会抛错，这里换成空模块；@/ 路径别名由 esbuild 按 tsconfig 解析。
import { build } from "esbuild";

await build({
  entryPoints: ["src/worker/index.ts"],
  outfile: "dist/worker.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  // pg 的可选原生绑定，用不到
  external: ["pg-native"],
  alias: { "server-only": "./scripts/empty.mjs" },
  // 打包进来的 CommonJS 依赖需要 require
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
