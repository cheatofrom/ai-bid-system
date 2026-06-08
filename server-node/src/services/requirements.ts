import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { superdocService } from './superdoc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_DATA_DIR = path.join(__dirname, '..', '..', '.data', 'pdf-library');
const SESSIONS_DIR = path.join(__dirname, '..', '..', '.data', 'sessions');

type EmitFn = (event: string, data: any) => void;

// ============ 数据结构 ============

export interface Requirement {
  id: string;
  category: 'starClause' | 'techParam' | 'commercialTerm' | 'document' | 'format' | 'qualification';
  content: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  sourceRef: string;
  isStar: boolean;
}

export interface RequirementsList {
  pdfId: string;
  extractedAt: string;
  totalCount: number;
  categories: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  requirements: Requirement[];
}

export interface PlanSection {
  id: string;
  sectionName: string;
  source: 'template' | 'create';
  templateNodeId?: string;
  status: 'ready' | 'needs_content' | 'needs_section' | 'skipped';
  requirements: string[];
  notes: string;
}

export interface ResponsePlan {
  pdfId: string;
  sessionId: string;
  createdAt: string;
  templateFile: string;
  summary: {
    totalRequirements: number;
    mappedToTemplate: number;
    needsNewSection: number;
    skipped: number;
  };
  sections: PlanSection[];
  unmappedRequirements: string[];
}

// ============ 需求拆解 ============

export async function extractRequirements(
  pdfId: string,
  modelConfig: { apiKey: string; baseURL: string; model: string },
  emit: EmitFn,
): Promise<RequirementsList> {
  const pdfDir = path.join(PDF_DATA_DIR, pdfId);
  const bidInfoPath = path.join(pdfDir, 'bid_info.json');
  const fullTextPath = path.join(pdfDir, 'full_text.txt');

  // 读取已有数据
  const bidInfo = JSON.parse(await fs.readFile(bidInfoPath, 'utf-8'));
  const fullText = await fs.readFile(fullTextPath, 'utf-8');

  const openai = new OpenAI({ apiKey: modelConfig.apiKey, baseURL: modelConfig.baseURL });
  const temp = modelConfig.model.includes('moonshot') || modelConfig.model.includes('kimi') ? 1 : 0.1;

  emit('status', { message: '正在从招标文件中提取需求清单...' });

  // 将 bid_info 数据整理为上下文
  const bidContext = `
## 项目信息
${JSON.stringify(bidInfo.projectInfo, null, 2)}

## ★条款（共${bidInfo.starClauses?.length || 0}条）
${(bidInfo.starClauses || []).map((c: any, i: number) => `${i + 1}. ${c.content}`).join('\n')}

## 技术参数（共${bidInfo.techParams?.length || 0}条）
${(bidInfo.techParams || []).map((p: any, i: number) => `${i + 1}. ${p.name}: ${p.requirement}`).join('\n')}

## 商务条款（共${bidInfo.commercialTerms?.length || 0}条）
${(bidInfo.commercialTerms || []).map((t: any, i: number) => `${i + 1}. ${t.item}: ${t.requirement}`).join('\n')}

## 投标文件组成（共${bidInfo.documentComposition?.length || 0}部分）
${(bidInfo.documentComposition || []).map((d: any) => `${d.order}. ${d.partName}: ${d.description}`).join('\n')}
`.trim();

  // 截取 full_text 中可能包含的额外要求（资质、格式、附件等）
  // 取前 8000 字作为补充上下文
  const supplementText = fullText.substring(0, 8000);

  const prompt = `你是一个投标文件分析师。请根据以下招标文件的结构化数据，提取出一份完整的需求清单。

## 任务
将招标文件中的所有要求整理为一个扁平的需求清单，每个需求一个条目。

## 优先级规则
- critical：★条款（必须响应，不响应则废标）
- high：文档组成部分（每个部分都需要提供）、重要技术参数
- medium：一般商务条款、格式要求
- low：可选要求、建议性内容

## 分类规则
- starClause：标注★的条款
- techParam：技术参数和规格要求
- commercialTerm：商务条款（交货、付款、质保、培训等）
- document：投标文件组成部分（需要提供哪些文件/章节）
- format：格式要求（装订、份数、签章等）
- qualification：资质要求（证书、业绩、人员等）

## 输出格式（严格 JSON）
{
  "requirements": [
    {
      "id": "R-001",
      "category": "starClause",
      "content": "需求的具体描述",
      "priority": "critical",
      "sourceRef": "starClauses[0]",
      "isStar": true
    }
  ]
}

## 已提取的结构化数据
${bidContext}

## 补充：招标文件原文片段（用于提取结构化数据中遗漏的要求）
${supplementText}

请提取所有需求，不要遗漏。id 从 R-001 开始递增。只输出 JSON，不要其他内容。`;

  emit('status', { message: '正在调用 AI 分析需求...' });

  const stream = await openai.chat.completions.create({
    model: modelConfig.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: temp,
    stream: true,
  });

  let resultText = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      resultText += content;
      emit('token', { text: content });
    }
  }

  // 解析结果
  let requirements: Requirement[] = [];
  try {
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      requirements = (parsed.requirements || []).map((r: any, i: number) => ({
        id: r.id || `R-${String(i + 1).padStart(3, '0')}`,
        category: r.category || 'commercialTerm',
        content: r.content || '',
        priority: r.priority || 'medium',
        sourceRef: r.sourceRef || '',
        isStar: r.isStar || false,
      }));
    }
  } catch (e) {
    console.error('[requirements] 解析失败:', e);
    emit('error', { message: 'AI 返回结果解析失败' });
    throw new Error('需求拆解结果解析失败');
  }

  // 统计
  const categories = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of requirements) {
    categories[r.priority]++;
  }

  const result: RequirementsList = {
    pdfId,
    extractedAt: new Date().toISOString(),
    totalCount: requirements.length,
    categories,
    requirements,
  };

  // 保存
  await fs.writeFile(path.join(pdfDir, 'requirements.json'), JSON.stringify(result, null, 2));

  // 更新 meta.json
  try {
    const metaPath = path.join(pdfDir, 'meta.json');
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
    meta.requirements_count = requirements.length;
    meta.requirements_extracted_at = result.extractedAt;
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  } catch {}

  emit('status', { message: `需求拆解完成，共提取 ${requirements.length} 条需求` });
  emit('result', { data: result });

  return result;
}

// ============ 响应规划 ============

export async function generatePlan(
  pdfId: string,
  sessionId: string,
  modelConfig: { apiKey: string; baseURL: string; model: string },
  emit: EmitFn,
): Promise<ResponsePlan> {
  const pdfDir = path.join(PDF_DATA_DIR, pdfId);
  const sessionDir = path.join(SESSIONS_DIR, sessionId);
  const requirementsPath = path.join(pdfDir, 'requirements.json');

  // 读取需求清单
  const requirementsList: RequirementsList = JSON.parse(await fs.readFile(requirementsPath, 'utf-8'));

  // 读取 session meta 获取模板文件名
  const sessionMetaPath = path.join(sessionDir, 'meta.json');
  let templateFile = '';
  try {
    const sessionMeta = JSON.parse(await fs.readFile(sessionMetaPath, 'utf-8'));
    templateFile = sessionMeta.templateName || '';
  } catch {}

  emit('status', { message: '正在读取模板结构...' });

  // 通过 SuperDoc SDK 获取模板的 block 结构
  let templateBlocks: any[] = [];
  try {
    const blocksResult = await superdocService.callTool(sessionId, 'superdoc_get_content', {
      action: 'blocks',
      includeText: true,
    });
    templateBlocks = blocksResult?.blocks || blocksResult?.items || [];
  } catch (e: any) {
    console.error('[plan] 获取模板结构失败:', e.message);
    emit('status', { message: '获取模板结构失败，将基于需求直接规划' });
  }

  // 将模板 blocks 整理为可读的结构
  const templateStructure = templateBlocks.length > 0
    ? templateBlocks.slice(0, 100).map((b: any, i: number) => {
        const text = (b.text || b.content || '').substring(0, 200);
        const nodeType = b.nodeType || b.type || 'unknown';
        const nodeId = b.nodeId || b.id || '';
        return `[${i}] type=${nodeType}, nodeId=${nodeId}: ${text}`;
      }).join('\n')
    : '（无法读取模板结构）';

  const openai = new OpenAI({ apiKey: modelConfig.apiKey, baseURL: modelConfig.baseURL });
  const temp = modelConfig.model.includes('moonshot') || modelConfig.model.includes('kimi') ? 1 : 0.1;

  emit('status', { message: '正在生成响应计划...' });

  // 需求摘要（避免 prompt 过长）
  const reqSummary = requirementsList.requirements.map(r =>
    `${r.id} [${r.priority}${r.isStar ? '★' : ''}] (${r.category}): ${r.content.substring(0, 150)}`
  ).join('\n');

  const prompt = `你是一个投标文件规划师。请根据招标需求清单和投标模板结构，生成一份响应计划。

## 任务
1. 将需求清单中的每条需求映射到模板中的对应章节
2. 识别模板中缺失的章节（即需求没有对应的模板章节）
3. 为每个章节生成填写指导

## 模板结构（block 列表）
${templateStructure}

## 需求清单
${reqSummary}

## 输出格式（严格 JSON）
{
  "sections": [
    {
      "id": "S-01",
      "sectionName": "章节名称",
      "source": "template",
      "templateNodeId": "从模板结构中获取的nodeId（如果source=template）",
      "status": "needs_content",
      "requirements": ["R-001", "R-002"],
      "notes": "填写指导：需要包含哪些内容，注意哪些要点"
    }
  ],
  "unmappedRequirements": ["R-099"]
}

## 规则
- source="template"：模板中已有该章节，只需填写内容
- source="create"：模板中没有该章节，需要新建
- status="ready"：已有内容，可能只需微调
- status="needs_content"：章节框架在但内容为空，需要填写
- status="needs_section"：章节不存在，需要创建
- status="skipped"：不需要响应的需求
- 尽量将相关需求归入同一章节
- notes 中要具体说明需要填写什么内容、引用哪些需求
- 只输出 JSON，不要其他内容`;

  const stream = await openai.chat.completions.create({
    model: modelConfig.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: temp,
    stream: true,
  });

  let resultText = '';
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) {
      resultText += content;
      emit('token', { text: content });
    }
  }

  // 解析结果
  let sections: PlanSection[] = [];
  let unmappedRequirements: string[] = [];
  try {
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      sections = (parsed.sections || []).map((s: any, i: number) => ({
        id: s.id || `S-${String(i + 1).padStart(2, '0')}`,
        sectionName: s.sectionName || '未命名章节',
        source: s.source || 'create',
        templateNodeId: s.templateNodeId || undefined,
        status: s.status || 'needs_content',
        requirements: s.requirements || [],
        notes: s.notes || '',
      }));
      unmappedRequirements = parsed.unmappedRequirements || [];
    }
  } catch (e) {
    console.error('[plan] 解析失败:', e);
    emit('error', { message: '响应计划解析失败' });
    throw new Error('响应计划结果解析失败');
  }

  // 统计
  const summary = {
    totalRequirements: requirementsList.totalCount,
    mappedToTemplate: sections.filter(s => s.source === 'template').length,
    needsNewSection: sections.filter(s => s.source === 'create').length,
    skipped: sections.filter(s => s.status === 'skipped').length,
  };

  const plan: ResponsePlan = {
    pdfId,
    sessionId,
    createdAt: new Date().toISOString(),
    templateFile,
    summary,
    sections,
    unmappedRequirements,
  };

  // 保存到 session 目录
  await fs.writeFile(path.join(sessionDir, 'response_plan.json'), JSON.stringify(plan, null, 2));

  emit('status', {
    message: `响应计划生成完成：${summary.mappedToTemplate} 个模板章节 + ${summary.needsNewSection} 个需新建章节`,
  });
  emit('result', { data: plan });

  return plan;
}
