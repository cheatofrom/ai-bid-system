import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import { configService } from '../services/config.js';
import { extractRequirements, generatePlan } from '../services/requirements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data', 'pdf-library');

const upload = multer({ storage: multer.memoryStorage() });
export const pdfLibraryRouter = Router();

// 初始化
(async () => {
  await fs.mkdir(DATA_DIR, { recursive: true });
})();

// 列出 PDF
pdfLibraryRouter.get('/list', async (req: Request, res: Response) => {
  try {
    const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
    const items: any[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metaPath = path.join(DATA_DIR, entry.name, 'meta.json');
        try {
          const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
          items.push(meta);
        } catch {}
      }
    }

    items.sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || ''));
    res.json({ items });
  } catch {
    res.json({ items: [] });
  }
});

// 上传 PDF
pdfLibraryRouter.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: '请上传文件' });
    }

    // 修复中文文件名编码
    let filename = file.originalname;
    try {
      // 尝试修复乱码
      filename = Buffer.from(filename, 'latin1').toString('utf8');
    } catch {}
    if (!filename.endsWith('.pdf')) {
      filename = filename + '.pdf';
    }

    const pdfId = uuidv4().substring(0, 8);
    const pdfDir = path.join(DATA_DIR, pdfId);
    await fs.mkdir(pdfDir, { recursive: true });

    await fs.writeFile(path.join(pdfDir, 'original.pdf'), file.buffer);

    const meta = {
      id: pdfId,
      filename,
      size: file.size,
      uploaded_at: new Date().toISOString(),
      status: 'uploaded',
      page_count: 0,
      char_count: 0,
      pages: [],
      bid_info: null,
      outline: [],
    };

    await fs.writeFile(
      path.join(pdfDir, 'meta.json'),
      JSON.stringify(meta, null, 2)
    );

    res.json({ id: pdfId, filename, status: 'uploaded' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 获取 PDF 详情
pdfLibraryRouter.get('/:pdfId', async (req: Request, res: Response) => {
  const { pdfId } = req.params;
  const metaPath = path.join(DATA_DIR, pdfId, 'meta.json');

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    res.json(meta);
  } catch {
    res.status(404).json({ error: 'PDF 不存在' });
  }
});

// 删除 PDF
pdfLibraryRouter.delete('/:pdfId', async (req: Request, res: Response) => {
  const { pdfId } = req.params;
  const pdfDir = path.join(DATA_DIR, pdfId);

  try {
    await fs.rm(pdfDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'PDF 不存在' });
  }
});

// 解析 PDF（使用 pdfjs-dist 逐页解析）
pdfLibraryRouter.post('/:pdfId/parse', async (req: Request, res: Response) => {
  const { pdfId } = req.params;
  const pdfDir = path.join(DATA_DIR, pdfId);
  const metaPath = path.join(pdfDir, 'meta.json');
  const pdfPath = path.join(pdfDir, 'original.pdf');

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    const pdfBuffer = await fs.readFile(pdfPath);

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'no-cache');

    // 更新状态
    meta.status = 'parsing';
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    try {
      // 使用 pdfjs-dist 逐页解析
      const pdfjsLib = await import('pdfjs-dist');

      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
      const pdfDoc = await loadingTask.promise;
      const totalPages = pdfDoc.numPages;

      const pages: any[] = [];
      let fullText = '';

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();

        // 提取文本
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');

        pages.push({
          page_number: i,
          text: pageText,
          char_count: pageText.length,
          table_count: 0,
          preview: pageText.substring(0, 200),
        });
        fullText += pageText + '\n\n';

        res.write(JSON.stringify({
          type: 'progress',
          current: i,
          total: totalPages,
          page_preview: pageText.substring(0, 100),
        }) + '\n');
      }

      // 保存解析结果
      meta.status = 'parsed';
      meta.page_count = totalPages;
      meta.char_count = fullText.length;
      meta.pages = pages;
      meta.parsed_at = new Date().toISOString();

      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
      await fs.writeFile(path.join(pdfDir, 'full_text.txt'), fullText);
      await fs.writeFile(path.join(pdfDir, 'pages.json'), JSON.stringify(pages, null, 2));

      res.write(JSON.stringify({
        type: 'done',
        page_count: totalPages,
        char_count: fullText.length,
      }) + '\n');

    } catch (parseError: any) {
      console.error('[pdf] 解析失败:', parseError);
      meta.status = 'error';
      meta.error = parseError.message;
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

      res.write(JSON.stringify({
        type: 'error',
        message: parseError.message,
      }) + '\n');
    }

    res.end();
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// AI 分析目录（流式输出）
pdfLibraryRouter.post('/:pdfId/analyze-outline', async (req: Request, res: Response) => {
  const { pdfId } = req.params;
  const pdfDir = path.join(DATA_DIR, pdfId);
  const metaPath = path.join(pdfDir, 'meta.json');
  const pagesPath = path.join(pdfDir, 'pages.json');

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    const pages = JSON.parse(await fs.readFile(pagesPath, 'utf-8'));

    // 取前5页内容
    const frontText = pages.slice(0, 5).map((p: any) => p.text).join('\n\n');

    // 获取模型配置
    const modelConfig = configService.getModelConfig();
    const openai = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL,
    });

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const emit = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    emit('status', { message: '正在分析目录...' });

    const prompt = `请从以下招标文件内容中，找到"目录"部分，把目录内容完整提取出来。

要求：
- 只提取目录，不要提取正文内容
- 保持目录原有的格式和层级
- 直接返回目录文本，不需要额外格式化

内容：
${frontText}`;

    // Kimi 系列模型只允许 temperature=1
    const temp = modelConfig.model.includes('moonshot') || modelConfig.model.includes('kimi') ? 1 : 0.1;

    // 流式调用
    let outlineText = '';
    const stream = await openai.chat.completions.create({
      model: modelConfig.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: temp,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        outlineText += content;
        emit('token', { text: content });
      }
    }

    // 保存目录
    meta.outline_text = outlineText;
    meta.outline_generated_by_ai = true;
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    await fs.writeFile(path.join(pdfDir, 'outline.txt'), outlineText);

    emit('done', { outline_text: outlineText });
    res.end();
  } catch (e: any) {
    console.error('[pdf] AI 分析目录失败:', e);
    res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
    res.end();
  }
});

// AI 拆解招标文件（流式输出）
pdfLibraryRouter.post('/:pdfId/analyze', async (req: Request, res: Response) => {
  const { pdfId } = req.params;
  const pdfDir = path.join(DATA_DIR, pdfId);
  const metaPath = path.join(pdfDir, 'meta.json');
  const fullTextPath = path.join(pdfDir, 'full_text.txt');

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));

    if (meta.status !== 'parsed') {
      return res.status(400).json({ error: 'PDF 尚未解析，请先解析' });
    }

    const fullText = await fs.readFile(fullTextPath, 'utf-8');

    // 获取模型配置
    const modelConfig = configService.getModelConfig();
    const openai = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL,
    });

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const emit = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    emit('status', { message: '正在 AI 拆解招标文件...' });

    // 分段分析，每段约15000字，重叠2000字避免遗漏
    const CHUNK_SIZE = 15000;
    const OVERLAP = 2000;
    const chunks: string[] = [];
    for (let i = 0; i < fullText.length; i += CHUNK_SIZE - OVERLAP) {
      chunks.push(fullText.substring(i, i + CHUNK_SIZE));
    }

    emit('status', { message: `文档共 ${fullText.length} 字，分 ${chunks.length} 段分析` });

    // 收集所有结果
    const allStarClauses: any[] = [];
    const allTechParams: any[] = [];
    const allCommercialTerms: any[] = [];
    let projectInfo: any = {};
    let documentComposition: any[] = [];

    for (let i = 0; i < chunks.length; i++) {
      emit('status', { message: `正在分析第 ${i + 1}/${chunks.length} 段...` });

      const prompt = `请仔细分析以下招标文件内容片段，提取所有关键信息。

要求：
1. 提取项目基本信息（名称、编号、采购单位、预算、截止时间、交货地点等）
2. 提取所有标注★的条款（必须响应的条款，非常重要！）
3. 提取所有技术参数和要求（设备规格、数量、性能要求等）
4. 提取商务条款（交货期限、付款方式、质量保证、培训要求等）
5. 提取投标文件组成部分

请返回 JSON 格式：
{
  "projectInfo": {
    "projectName": "项目名称",
    "projectCode": "项目编号",
    "purchaser": "采购单位",
    "budget": "预算金额",
    "deadline": "投标截止时间",
    "location": "交货地点"
  },
  "starClauses": [
    {"content": "★条款内容"}
  ],
  "techParams": [
    {"name": "参数名称", "requirement": "参数要求"}
  ],
  "commercialTerms": [
    {"item": "条款名称", "requirement": "条款要求"}
  ],
  "documentComposition": [
    {"order": 1, "partName": "文件组成部分", "description": "说明"}
  ]
}

这是第 ${i + 1} 段，共 ${chunks.length} 段。请提取本段中所有相关信息。

内容：
${chunks[i]}`;

      const temp = modelConfig.model.includes('moonshot') || modelConfig.model.includes('kimi') ? 1 : 0.1;

      let resultText = '';
      const stream = await openai.chat.completions.create({
        model: modelConfig.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: temp,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          resultText += content;
          emit('token', { text: content });
        }
      }

      // 解析本段结果
      try {
        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const partResult = JSON.parse(jsonMatch[0]);

          // 合并项目信息（后面的覆盖前面的空值）
          if (partResult.projectInfo) {
            projectInfo = { ...projectInfo, ...Object.fromEntries(
              Object.entries(partResult.projectInfo).filter(([_, v]) => v)
            )};
          }

          // 合并★条款（去重）
          if (partResult.starClauses) {
            for (const clause of partResult.starClauses) {
              if (!allStarClauses.some(c => c.content === clause.content)) {
                allStarClauses.push(clause);
              }
            }
          }

          // 合并技术参数（去重）
          if (partResult.techParams) {
            for (const param of partResult.techParams) {
              if (!allTechParams.some(p => p.name === param.name && p.requirement === param.requirement)) {
                allTechParams.push(param);
              }
            }
          }

          // 合并商务条款（去重）
          if (partResult.commercialTerms) {
            for (const term of partResult.commercialTerms) {
              if (!allCommercialTerms.some(t => t.item === term.item)) {
                allCommercialTerms.push(term);
              }
            }
          }

          // 合并文档组成（去重）
          if (partResult.documentComposition) {
            for (const doc of partResult.documentComposition) {
              if (!documentComposition.some(d => d.order === doc.order)) {
                documentComposition.push(doc);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[pdf] 第 ${i + 1} 段解析失败:`, e);
      }
    }

    // 汇总结果
    const bidInfo = {
      projectInfo,
      starClauses: allStarClauses,
      techParams: allTechParams,
      commercialTerms: allCommercialTerms,
      documentComposition: documentComposition.sort((a, b) => a.order - b.order),
    };

    // 保存拆解结果
    meta.bid_info = bidInfo;
    meta.analyzed_at = new Date().toISOString();
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    await fs.writeFile(path.join(pdfDir, 'bid_info.json'), JSON.stringify(bidInfo, null, 2));

    emit('result', { data: bidInfo });

    res.end();
  } catch (e: any) {
    console.error('[pdf] AI 拆解失败:', e);
    res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
    res.end();
  }
});

// 提取需求清单（SSE 流式）
pdfLibraryRouter.post('/:pdfId/extract-requirements', async (req: Request, res: Response) => {
  const { pdfId } = req.params;
  const pdfDir = path.join(DATA_DIR, pdfId);

  try {
    // 检查是否已拆解
    const bidInfoPath = path.join(pdfDir, 'bid_info.json');
    try {
      await fs.access(bidInfoPath);
    } catch {
      return res.status(400).json({ error: '请先完成 AI 拆解' });
    }

    const modelConfig = configService.getModelConfig(req.body?.model_key);

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const emit = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    await extractRequirements(pdfId, modelConfig, emit);
    res.end();
  } catch (e: any) {
    console.error('[pdf] 需求拆解失败:', e);
    const emit = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    emit('error', { message: e.message });
    res.end();
  }
});

// 获取已提取的需求清单
pdfLibraryRouter.get('/:pdfId/requirements', async (req: Request, res: Response) => {
  const { pdfId } = req.params;
  const requirementsPath = path.join(DATA_DIR, pdfId, 'requirements.json');

  try {
    const data = JSON.parse(await fs.readFile(requirementsPath, 'utf-8'));
    res.json(data);
  } catch {
    res.json(null);
  }
});

// 生成响应计划（SSE 流式）
pdfLibraryRouter.post('/:pdfId/generate-plan', async (req: Request, res: Response) => {
  const { pdfId } = req.params;
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ error: '请提供 session_id' });
  }

  try {
    // 检查需求清单是否存在
    const requirementsPath = path.join(DATA_DIR, pdfId, 'requirements.json');
    try {
      await fs.access(requirementsPath);
    } catch {
      return res.status(400).json({ error: '请先提取需求清单' });
    }

    const modelConfig = configService.getModelConfig(req.body?.model_key);

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const emit = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    await generatePlan(pdfId, session_id, modelConfig, emit);
    res.end();
  } catch (e: any) {
    console.error('[pdf] 生成响应计划失败:', e);
    const emit = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    emit('error', { message: e.message });
    res.end();
  }
});

// 更新 PDF 信息
pdfLibraryRouter.patch('/:pdfId', async (req: Request, res: Response) => {
  const { pdfId } = req.params;
  const metaPath = path.join(DATA_DIR, pdfId, 'meta.json');

  try {
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));

    if (req.body.outline_text !== undefined) {
      meta.outline_text = req.body.outline_text;
    }

    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: 'PDF 不存在' });
  }
});
