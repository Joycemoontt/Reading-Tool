# PaperMind V4 验证报告（2026-11-04）

## 修复与根因

| 问题 | 根因 | 修改 | 验证 |
| --- | --- | --- | --- |
| VGGT 第 2 页译文顺序交错 | 双栏检测要求右栏 x 坐标大于页面宽度的 52%，但该页右栏起点为 317/612，落在阈值外 | `backend/app/parser.py` 按实际中线、左右块数量识别两栏；跨栏块作为分段边界 | 实际 PDF 和浏览器均得到 MASt3R → In this paper → We also show → There are several recent examples → To summarize → VGGT achieves → We make our code → Related Work |
| 旧段落重排会破坏学习记录 | 旧 ID 基于旧顺序 | `backend/app/main.py` 的安全重新解析要求页码、坐标和文本相似度唯一匹配，原位更新 order 与正文，保留 ID；不安全时返回 409 | VGGT 435 个段落原位重排；译文 124、笔记 2、标注 7 在迁移前后数量一致；回归测试检查锚点 |
| 公式文本碎裂 | PDF 字形层将上下标、求和、梯度分到多个块 | `parser.py` 识别候选区域并合并邻近数学块；原区域图像由 API 按需裁剪；不将提取文本视作可信 LaTeX | VGGT 第 6 页识别 5 个待核对区域；公式 (2) 图像与原 PDF 核对；实际 Gemini 视觉解释返回，浏览器 KaTeX 渲染正常 |
| 表格数值错列 | 普通段落抽取丢失行列，`find_tables().extract()` 又可能拆开小数点 | `parser.py` 用 `find_tables()` 的几何网格和每格 PDF 裁剪文本提取原值；前端独立 HTML 表格与原图并列 | VGGT 第 7 页 Table 1/2/3 行列数、首末行及关键数值与 PDF 核对；真实浏览器同页展示 |
| PDF 翻页后译文停留旧页 | 译文面板一次渲染全文且无页同步 | `Reader.tsx` 仅渲染当前物理页的译文和对象 | 真实浏览器第 7 页左侧 PDF、右侧 Table 1 同步；减轻长文 DOM 负担 |

## 新能力与实际范围

- **Explain Equation**：PDF 公式点击工具栏和对象卡片均可进入；Gemini 接收真实 PDF 裁剪图及邻近原文；回答保存 AI History，包含核对提示。当前不生成可信规范 LaTeX，也不自动验证全部符号。
- **Explain Table**：PDF 网格数据、原图、图注及视觉模型解释可用。Table 1 解释实际返回 93.5、91.8 和时间对比；数字需与 PDF 原图复核。
- **Explain Figure**：已识别的嵌入式位图可点击并传图给 Gemini。VGGT 图 1 实际调用成功。矢量图和非嵌入式绘图仍可能漏检。
- **My Paper Summary**：此前已实现独立草稿、AI 检查、润色接受/拒绝与版本历史；本轮回归测试通过。
- **AI Evidence Verification**：此前已实现原文短引文与段落 ID 匹配，浏览器可点击证据；本轮回归测试通过。视觉对象解释使用原图和页码，不使用伪造的段落引用。

## VGGT 实测

| 项目 | 结果 |
| --- | --- |
| 第 2 页双栏 | 左栏 5 块完整输出后进入右栏，Related Work 出现在右栏 VGGT 结果之后。浏览器原文顺序同样核对。 |
| 第 6 页公式 | 式 (2) 的多任务损失原图可见；Gemini 视觉解释实际成功，界面渲染上下标和公式。复杂公式的机器转写未标为已验证。 |
| 第 7 页 Table 1 | 13 行 × 4 列；首行 Colmap+SPSG 45.2/25.3，末行 Ours (with BA) 93.5/91.8。 |
| 第 7 页 Table 2 | 9 行 × 5 列；首数据行 Gipuma 0.283/0.873/0.578，末行 Ours 0.389/0.374/0.382。 |
| 第 7 页 Table 3 | 5 行 × 5 列；首行 DUSt3R 1.167/0.842/1.005，末行 Ours (Depth + Cam) 0.873/0.482/0.677。 |
| 翻译对齐 | 原译文按段落 ID 保留，重排后同一段落显示原译文；`translation-integrity` 显示该论文仍未全文翻译，不宣称翻译完成。 |
| 问答 | 公式、表格、图 1 的真实 Gemini 视觉调用返回；公式入口在浏览器点击成功，回答进入历史并渲染数学公式。 |

## 数据与回归

- 修改前先备份了本地 `backend/data/papermind.db` 与 `backend/data/papers/` 到工作区外的 `outputs/backup-2026-11-04/`。Git 不跟踪数据库、PDF 或 `.env`。
- 数据库迁移只添加可空列和对象表；没有删除原表或重建旧段落。实际 VGGT 安全重排成功且旧段落 ID 保持稳定。
- 后端 20 个单元 / API 测试、前端 13 个测试、Next.js 生产构建通过。真实浏览器核对第 2 页顺序、第 6 页公式点击与回答、第 7 页表格及分页同步。
- 既有 PDF 阅读、搜索、笔记、Quiz、总结、语音等路径通过已有自动化回归；本轮未重新用物理麦克风、真实后台锁屏或 Finder 拖放逐一手动测试。

## 启动与复核

按仓库根目录 `README.md` 安装依赖并设置 `backend/.env` 中的 `GEMINI_API_KEY`、`GEMINI_MODEL`。运行 `cd backend && ../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`，另开终端运行 `cd frontend && npm ci && npm run dev`。既有论文在阅读器点击「重新解析」；若返回锚点不安全，请保留原数据并人工核对。然后检查第 2 页段落顺序、第 6 页公式原图、第 7 页 Table 1/2/3，并可调用 `GET /api/papers/{id}/translation-integrity` 查看缺失译文。
