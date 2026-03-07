# F03 功能PRD：持仓导入（CSV + OCR）

## 1. 功能目标
降低首次建仓门槛，支持批量导入并控制数据质量。

## 2. 用户故事
- 作为新用户，我希望一次性导入多个平台持仓，而不是手动逐条录入。

## 3. 功能范围
- CSV 校验与提交
- OCR 识别生成草稿
- 草稿人工确认后入库
- 行级错误反馈

## 4. 业务规则
1. CSV 支持部分成功
2. OCR 低置信字段必须用户确认
3. 导入必须可追踪批次（batchId）

## 5. 接口映射
- `POST /api/v1/imports/csv/validate`
- `POST /api/v1/imports/csv/commit`
- `POST /api/v1/imports/ocr/draft`
- `POST /api/v1/imports/ocr/confirm`

## 6. 数据结构映射
- 入库后落 `position` + `position_txn`
- 建议补表：`import_batch`（v1.1）

## 7. 测试用例（按功能）
- F03-TC-001 CSV 全成功
- F03-TC-002 CSV 部分失败含行号
- F03-TC-003 OCR 草稿低置信标红
- F03-TC-004 OCR 未确认不可入库

## 8. 验收标准
- 首次导入完成率 >= 85%
- 导入错误可定位率 100%
