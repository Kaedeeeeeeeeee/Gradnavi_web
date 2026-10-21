// 前端可用的工具元信息（不含执行逻辑）：侧边栏据此显示中文名、决定是否刷新页面数据
export const TOOL_META: Record<string, { label: string; mutates: boolean }> = {
  read_user_md: { label: "读取 user.md", mutates: false },
  update_user_md: { label: "更新 user.md", mutates: true },
  list_todos: { label: "查看 Todo", mutates: false },
  add_todos: { label: "添加 Todo", mutates: true },
  update_todo: { label: "修改 Todo", mutates: true },
  list_documents: { label: "查看文书列表", mutates: false },
  read_document: { label: "读取文书", mutates: false },
  create_document: { label: "新建文书", mutates: true },
  update_document_section: { label: "写入文书", mutates: true },
  replace_document_text: { label: "改写文书", mutates: true },
  update_document: { label: "修改文书", mutates: true },
};
