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

## 已实现

- PDF 原版渲染、可选文字、页码导航、缩放、全文文字查找，以及双栏、段落、原版三种模式。
- PyMuPDF 提取章节和段落，过滤重复页眉页脚；译文、阅读位置、标注、笔记、词汇与 AI 历史保存在 SQLite。
- Gemini 全文翻译、选中文字翻译/解释、带当前段落及相邻原文的提问；词汇语境解释和 Again/Hard/Good/Easy 简单复习。
- 根据论文、笔记和词汇生成选择题与简答题；保存答题和 AI 反馈。
- Web Speech API 英文/中文朗读：全文、章节、选中段落，暂停/继续、上下段、速度、声音、语言和进度保存。播放器收起后继续朗读；有条件地接入 Media Session 控制。
- SpeechRecognition / webkitSpeechRecognition 语音提问：先暂停论文朗读，转录结果可编辑，发送到 Gemini 后保存到同一 AI 历史；可选择朗读 AI 回答。不保存原始录音。
- 可为公式段落生成并缓存 Gemini 口语说明，同时保留原文。

## 测试

```bash
cd backend && ../.venv/bin/python -m unittest discover -s tests -v
cd frontend && npm test && npm run build
```

自动化测试覆盖 PDF 上传、解析、翻译保存、笔记、标注、词汇、复习题、音频位置和带段落上下文的问答；前端测试覆盖朗读队列、暂停/恢复、跳段、双语、声音控制、识别结果和权限错误。开发时还用真实 PDF 在浏览器验证了渲染、英文/中文朗读推进和恢复，并用 Gemini 验证翻译及问答。

## 当前限制

- 浏览器语音合成的声音与后台播放行为取决于系统和浏览器。移动设备锁屏播放不能保证。Media Session 仅在支持的浏览器生效。
- 浏览器语音识别可能使用浏览器供应商的在线服务，并非保证离线；中英混合识别质量不稳定。无 SpeechRecognition 的浏览器仍可文字提问。物理麦克风转录需要在目标设备上实测。
- 扫描版 PDF 尚无 OCR。复杂双栏、公式和图表的自动阅读顺序需要人工核对；乱码块会跳过。公式口语说明需用户主动生成，不能替代公式原文。
- PDF 高亮依赖文本层匹配，跨多个文本 span 的选区可能只在记录列表中持久化，不能完整覆盖原版 PDF 页面。段落同步按页和对应段落进行，暂未提供精确的逐词高亮。
- 大型论文的翻译按段落批次进行，受 Gemini 免费额度和速率限制。没有自动切换付费模型。实际计费取决于 API key 所属账户的方案。
- 研究搜索、离线音频缓存、导出音频和移动端稳定锁屏播放属于后续阶段。当前复习题为基础版本，复杂题型与长期理解程度追踪仍需扩展。

## 技术结构

`frontend/`：Next.js、React、TypeScript、react-pdf / PDF.js。`backend/`：FastAPI、PyMuPDF、SQLAlchemy、SQLite、官方 `google-genai` SDK。`frontend/src/lib/audio-core.ts` 定义独立的 `TtsProvider` 接口，后续可以接入 Piper 等其他提供方。
