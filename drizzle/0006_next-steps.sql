ALTER TABLE "todo" ADD COLUMN "step_key" text;--> statement-breakpoint
ALTER TABLE "todo" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "todo_user_step_key_idx" ON "todo" USING btree ("user_id","step_key");--> statement-breakpoint
-- 旧版引导问卷生成的固定路线图：未完成的删掉，改由流程任务按进度生成
DELETE FROM "todo" WHERE "created_by" = 'system' AND "done" = false AND "step_key" IS NULL AND (
  "title" LIKE '确认申请路径（建议：%' OR "title" IN (
    '确定 3–5 所目标大学和研究科',
    '筛选 5–10 位候选教授',
    '阅读候选教授近 3 年的论文，记下研究课题',
    '结合教授方向写研究计划书草稿',
    '写套磁信，附计划书草稿联系教授',
    '把现有研究计划整理成计划书初稿',
    '和 AI 一起打磨计划书：问题意识、先行研究、研究方法',
    '按计划书匹配 5–10 位教授',
    '写套磁信，附计划书联系教授',
    '查目标大学研究生（研究生）的出愿时间和材料要求',
    '查目标大学研究生（旁听生）的出愿时间和材料要求',
    '查目标研究科修士课程的募集要项（出愿期、考试科目）',
    '整理已有研究成果（硕士论文、发表论文、学会报告）',
    '查目标研究科博士课程的募集要项',
    '制定日语学习计划，目标 JLPT N2 以上',
    '准备 TOEFL 或 TOEIC'
  )
);
