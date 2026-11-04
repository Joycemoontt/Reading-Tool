# PaperMind

PaperMind 是一个本地优先的科研论文阅读器，支持原版 PDF、中文对照、标注与笔记、Gemini 问答，以及浏览器语音朗读和语音提问。数据保存在本机 SQLite 和 `backend/data/papers/`，无需登录。

## 启动

需要 Python 3.11+ 和 Node.js 20+。

```bash
git clone https://github.com/Joycemoontt/Reading-Tool.git
cd Reading-Tool
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

在 `backend/.env` 中填入自己的 `GEMINI_API_KEY`，并保留或修改 `GEMINI_MODEL`。当前模板使用 `gemini-3.5-flash-lite`。API key 只由后端读取；`.env` 已加入 `.gitignore`。

分别启动两个终端：

```bash
cd backend
../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```bash
cd frontend
npm ci
npm run dev
```

访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)，点击「上传 PDF」或将 PDF 拖入首页。上传上限为 30 MB。首次打开默认双栏，点击「全文翻译」后，译文按批次保存；失败后再次点击会继续未完成的段落。API 文档位于 [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)。

升级已有安装时，更新代码和依赖后直接按上述方式启动。保留原来的 `backend/data/papermind.db` 与 `backend/data/papers/`；启动时只添加 v2 所需的表和可空列，不清空论文、译文或学习记录。建议先备份这两个本地路径。

## 已实现

- PDF 原版渲染、可选文字、页码导航、缩放、全文文字查找，以及双栏、段落、原版三种模式。
- PyMuPDF 提取章节和段落，过滤重复页眉页脚；译文、阅读位置、标注、笔记、词汇与 AI 历史保存在 SQLite。
- Gemini 全文翻译、选中文字翻译/解释、带当前段落及相邻原文的提问；词汇语境解释和 Again/Hard/Good/Easy 简单复习。
- 根据论文、笔记和词汇生成选择题与简答题；保存答题和 AI 反馈。
- Web Speech API 英文/中文朗读：全文、章节、选中段落，暂停/继续、上下段、速度、声音、语言和进度保存。播放器收起后继续朗读；有条件地接入 Media Session 控制。
- SpeechRecognition / webkitSpeechRecognition 语音提问：先暂停论文朗读，转录结果可编辑，发送到 Gemini 后保存到同一 AI 历史；可选择朗读 AI 回答。不保存原始录音。
- 可为公式段落生成并缓存 Gemini 口语说明，同时保留原文。

## v2 阅读体验

- PDF 标注使用独立、不可点击的透明坐标层。新标注保存选区每一行的相对坐标，缩放后仍能对齐；下划线为细线。旧标注保持原数据，并从 PDF 文本层尽可能还原位置。
- 中文译文按真实 PDF 页码分组，同页只显示一次页码。点击译文段落会定位原文的行框；点击原文段落会滚动到译文。两侧普通手动滚动不会互相牵引。
- 英文和中文译文都可选中文字进行解释、标注、笔记和问答；英文还可翻译、加下划线、保存多词专业术语。翻译与解释在后端使用不同任务指令。AI 回答按轻量格式展示，并显示请求状态、具体错误和重试入口。
- 阅读界面压缩工具栏与装饰，双栏分割线及学习助手宽度可拖动调整。PDF 页码、缩放和三种阅读模式仍可使用。
- 文献库支持文件夹创建、重命名、删除、论文移动；删除文件夹会将其论文移入“未分类”。可将多个 PDF 拖到首页或指定文件夹，也可通过上传按钮多选文件。
- 新上传 PDF 的文本提取会处理常见断词，并按双栏的左列、右列顺序组织段落。已有论文的段落 ID、翻译和标注不会因升级重新抽取。

### v2 数据库变更

迁移在后端启动时自动执行，重复执行安全：新增 `folders` 表、`papers.folder_id`、`annotations.rects_json`、`annotations.source` 和 `paragraphs.line_boxes_json`。已有论文的 `folder_id` 为空，显示在“未分类”；旧英文标注的 `source` 默认为 `en`，旧段落坐标使用原 bounding box。无需手动运行迁移脚本。

## 测试

```bash
cd backend && ../.venv/bin/python -m unittest discover -s tests -v
cd frontend && npm test && npm run build
```

自动化测试覆盖 PDF 上传、解析、翻译保存、笔记、标注、词汇、复习题、音频位置、文件夹生命周期、兼容迁移、双栏顺序与带段落上下文的问答；前端测试覆盖朗读队列、暂停/恢复、跳段、双语、声音控制、识别结果和权限错误。v2 开发时使用双页 PDF 在浏览器验证了标注几何、译文分页、点击定位、缩放、分栏拖动、中文选区、文件夹上传、词组保存与笔记；用 Gemini 验证了翻译、解释和问答。

## 当前限制

- 浏览器语音合成的声音与后台播放行为取决于系统和浏览器。移动设备锁屏播放不能保证。Media Session 仅在支持的浏览器生效。
- 浏览器语音识别可能使用浏览器供应商的在线服务，并非保证离线；中英混合识别质量不稳定。无 SpeechRecognition 的浏览器仍可文字提问。物理麦克风转录需要在目标设备上实测。
- 扫描版 PDF 尚无 OCR。复杂双栏、公式和图表的自动阅读顺序需要人工核对；乱码块会跳过。公式口语说明需用户主动生成，不能替代公式原文。
- 旧版没有保存选区矩形的标注需要由 PDF 文本层匹配恢复；遇到乱码或非常复杂的跨栏选区时可能无法完全重建。新标注保存相对坐标。跨多个 PDF 页面的单次选区尚不支持。
- 新上传论文可记录逐行坐标，旧论文保留原有段落框；复杂双栏或不规则版式仍建议人工核对阅读顺序。没有自动重新解析旧论文，以保护原有翻译和标注关联。
- 大型论文的翻译按段落批次进行，受 Gemini 免费额度和速率限制。没有自动切换付费模型。实际计费取决于 API key 所属账户的方案。
- 研究搜索、离线音频缓存、导出音频和移动端稳定锁屏播放属于后续阶段。当前复习题为基础版本，复杂题型与长期理解程度追踪仍需扩展。

## 技术结构

`frontend/`：Next.js、React、TypeScript、react-pdf / PDF.js。`backend/`：FastAPI、PyMuPDF、SQLAlchemy、SQLite、官方 `google-genai` SDK。`frontend/src/lib/audio-core.ts` 定义独立的 `TtsProvider` 接口，后续可以接入 Piper 等其他提供方。
