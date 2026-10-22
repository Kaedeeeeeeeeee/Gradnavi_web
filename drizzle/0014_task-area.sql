-- 任务分类（语言考试 / 专业课和备考 / 申请准备 / 其他）：主页待办按教授、研究科和分类分组；为空时自动归类
ALTER TABLE "todo" ADD COLUMN "area" text;