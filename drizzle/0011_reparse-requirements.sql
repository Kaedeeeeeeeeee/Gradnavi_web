-- 入试要点改为在页面缺考试科目 / 联系要求时读要项全文：清空指纹，让关注中的研究科下次检查时重新解析一次
UPDATE "graduate_school" SET "content_hash" = NULL;
