# 烟厂采购标书自动化生成系统

> 上传招标文件（PDF），自动生成符合格式要求的完整投标文件（DOCX）

## 核心能力

- **PDF 解析**：pdfjs-dist 提取 20-50 页中文招标文件
- **AI 拆解**：大模型提取项目信息、★条款、技术参数、评分标准
- **模板填充**：8 个章节使用 DOCX 模板精确填充（占位符替换）
- **AI 生成**：3 个章节使用 Agent 循环生成（生成→自查→修正→再检查）
- **精确排版**：SuperDoc SDK 操作 OOXML，格式铁则精确控制
- **在线编辑**：SuperDoc Editor 浏览器内预览编辑
- **合规检查**：自动检查★条款覆盖、格式、完整性

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| UI | Ant Design |
| 文档引擎 | superdoc + @superdoc-dev/react + @superdoc-dev/sdk |
| PDF 解析 | pdfjs-dist |
| AI 大模型 | OpenAI 兼容格式（通义千问/DeepSeek/智谱） |

## 快速开始

```bash
# 安装依赖
npm install

# 配置大模型 API Key
# 编辑 src/config/modelConfig.ts 或在页面设置中填入

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 项目结构

```
src/
├── main.tsx                  # 应用入口
├── App.tsx                   # 根组件（步骤流程）
├── types/                    # TypeScript 类型定义
│   ├── bid.ts                # 招标文件类型
│   ├── company.ts            # 公司信息类型
│   └── document.ts           # 文档生成类型
├── config/                   # 配置模块
│   ├── formatRules.ts        # 格式铁则
│   ├── modelConfig.ts        # 大模型配置
│   └── companyInfo.ts        # 公司信息
├── services/                 # 核心服务
│   ├── pdfParser.ts          # PDF 解析
│   ├── llmClient.ts          # LLM 调用客户端
│   ├── bidAnalyzer.ts        # 招标拆解
│   ├── complianceChecker.ts  # 合规检查
│   └── docService.ts         # 文档操作服务
├── agent/                    # Agent 核心逻辑
│   ├── orchestrator.ts       # 双轨调度主控
│   ├── templateFiller.ts     # 模板填充引擎
│   ├── chapterGenerator.ts   # AI 章节生成+迭代
│   ├── selfChecker.ts        # AI 自查模块
│   ├── contentEditor.ts      # SDK 文档操作封装
│   └── formatApplier.ts      # 格式铁则应用
├── ai/prompts/               # Prompt 模板
│   ├── techProposal.ts       # 技术方案
│   ├── afterSales.ts         # 售后方案
│   └── selfCheck.ts          # 自查+修正
├── pages/                    # 页面组件
│   ├── UploadPage.tsx        # 上传
│   ├── AnalyzePage.tsx       # 拆解确认
│   ├── GeneratePage.tsx      # 生成进度
│   └── EditorPage.tsx        # 编辑导出
├── components/               # 通用组件
│   └── DocEditor.tsx         # SuperDoc 编辑器封装
├── templates/                # DOCX 模板文件（9个）
│   ├── cover.docx            # 封面
│   ├── bid_letter.docx       # 投标函
│   ├── authorization.docx    # 授权委托书
│   ├── commitment.docx       # 承诺函
│   ├── quotation.docx        # 报价表
│   ├── business_qual.docx    # 商务资质
│   ├── attachment_list.docx  # 附件清单
│   ├── tech_deviation.docx   # 技术偏离表
│   └── after_sales.docx      # 售后方案
└── utils/
    └── fontUtils.ts          # 字体加载
```

## 处理流程

```
上传 PDF → PDF 解析 → AI 拆解 → 双轨生成 → 合规检查 → 导出 DOCX
                              │
                    ┌─────────┴─────────┐
                    │                   │
              轨道A: 模板填充       轨道B: AI 循环
              (8章节, 秒级)        (3章节, 多轮迭代)
              精度 100%            生成→自查→修正
```

## 格式铁则

| 格式项 | 规范 |
|--------|------|
| 一级标题 | 三号黑体 (16pt SimHei)，加粗，居中 |
| 二级标题 | 小三黑体 (15pt SimHei)，左对齐 |
| 三级标题 | 四号黑体 (14pt SimHei)，加粗 |
| 正文 | 小四仿宋 (12pt FangSong_GB2312) |
| 行距 | 1.5 倍 |
| 页面 | A4，上下 2.54cm，左右 3.17cm |
| ★条款 | 红色 (#FF0000) |
| 待补充 | 橙色 (#FF8C00) |

## License

Internal use only.
