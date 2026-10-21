// 前端可用的工具元信息（不含执行逻辑）：侧边栏据此显示中文名、决定是否刷新页面数据
export const TOOL_META: Record<string, { label: string; mutates: boolean }> = {
  read_user_md: { label: "读取 user.md", mutates: false },
  update_user_md: { label: "更新 user.md", mutates: true },
  list_todos: { label: "查看 Todo", mutates: false },
  add_todos: { label: "添加 Todo", mutates: true },
  update_todo: { label: "修改 Todo", mutates: true },
};
