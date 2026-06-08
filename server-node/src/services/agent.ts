import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { superdocService } from './superdoc.js';
import { sessionManager } from './session.js';
import { getSystemPrompt } from '@superdoc-dev/sdk';
import type { ResponsePlan } from './requirements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_DATA_DIR = path.join(__dirname, '..', '..', '.data', 'pdf-library');

type EmitFn = (event: string, data: any) => void;

interface AgentParams {
  message: string;
  history?: Array<{ role: string; content: string }>;
  pdfId?: string;
  sessionId?: string;  // SuperDoc 会话 ID（文档编辑）
  modelConfig: { apiKey: string; baseURL: string; model: string };
  emit: EmitFn;
  shouldStop?: () => boolean;
  responsePlan?: ResponsePlan;  // 可选，响应计划
  completedSteps?: string[];  // 已完成的步骤 ID 列表（用于恢复进度）
  waitForToolResult?: (toolCallId: string, toolName: string, toolArgs: any) => Promise<string>;  // 前端工具代理
}

const SYSTEM_PROMPT = `你是一个投标文件助手。你可以：
1. 查询招标文件（PDF）的内容
2. 编辑投标文件（Word 文档）

## 铁律：禁止编造信息
- 投标公司信息（公司名称、资质、业绩、人员、产品参数、价格等）必须从用户提供的资料中获取
- 如果用户没有提供某项公司信息，绝对不能编造、杜撰、假设
- 遇到缺少的公司信息，在文档中用醒目标记标注"【待补充：xxx】"，提醒用户手动填写
- 招标文件的内容可以从 PDF 中查询，但投标方的信息只能来自用户

## 工作流程
- 用户问招标文件内容时，用 PDF 工具查询
- 用户要求填写/编辑文档时，用 SuperDoc 工具操作

## 修改记录规则（非常重要）
- 文档中可能包含已有的修改记录（带删除线或下划线的文字），这些是之前的操作留下的
- 这些旧的修改记录不是文档的原始内容，不要把它们当作需要填写的内容
- 你只需要在正确的位置做新的编辑，不要尝试修改、接受或删除旧的修改记录
- 你的新编辑会自动产生新的修改记录，用户会自行决定接受或拒绝

## 回复规则
- 用自然语言回复
- 操作完成后告诉用户做了什么修改
- 保持专业友好的语气

## 重要：文档编辑规则

### 正确的编辑流程（必须严格遵守）

**第一步：读取文档**
superdoc_get_content({action: "blocks", includeText: true})
从返回的 blocks 中找到目标内容的 nodeId。

**第二步：用 superdoc_mutations 批量编辑（推荐）**
superdoc_mutations({
  action: "apply",
  atomic: true,
  steps: [{
    id: "s1",
    op: "text.rewrite",
    where: {by: "block", nodeType: "paragraph", nodeId: "<从get_content获取的nodeId>"},
    args: {replacement: {text: "新的文本内容"}}
  }]
})

**或者用 superdoc_edit 替换单个文本**
superdoc_edit({action: "replace", ref: "<从get_content获取的ref>", text: "新文本"})

### 关键规则
- ref 会在任何修改后过期，不要跨调用使用 ref
- 推荐用 superdoc_mutations + where:{by:"block", nodeId}，nodeId 不会过期
- select 参数必须是对象，不能是 JSON 字符串：{type: "text", pattern: "xxx"}
- 不要自己编造 ref 或 nodeId，必须从 get_content 结果获取
- 修改完成后用 superdoc_get_content 确认修改结果`;

// PDF 查询工具定义
const PDF_TOOLS: any[] = [
  {
    type: 'function',
    function: {
      name: 'get_pdf_outline',
      description: '获取招标文件的目录结构',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pdf_page',
      description: '获取招标文件指定页码的内容',
      parameters: {
        type: 'object',
        properties: { page_number: { type: 'number', description: '页码，从 1 开始' } },
        required: ['page_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pdf_pages',
      description: '获取招标文件多页内容',
      parameters: {
        type: 'object',
        properties: {
          start_page: { type: 'number', description: '起始页码' },
          end_page: { type: 'number', description: '结束页码' },
        },
        required: ['start_page', 'end_page'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_pdf',
      description: '在招标文件中搜索关键词',
      parameters: {
        type: 'object',
        properties: { keyword: { type: 'string', description: '要搜索的关键词' } },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_bid_info',
      description: '获取已分析的招标文件关键信息（项目信息、★条款、技术参数、商务条款）',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

// 响应计划进度报告工具（仅在有计划时可用）
const PROGRESS_TOOL: any = {
  type: 'function',
  function: {
    name: 'report_progress',
    description: '报告当前章节的填写进度。当一个章节填写完成后调用此工具。',
    parameters: {
      type: 'object',
      properties: {
        section_id: {
          type: 'string',
          description: '完成的章节 ID（如 S-01, S-02）',
        },
        status: {
          type: 'string',
          enum: ['done', 'skipped'],
          description: '该章节的状态：done=已完成, skipped=跳过',
        },
        summary: {
          type: 'string',
          description: '简要说明该章节填写了什么内容',
        },
      },
      required: ['section_id', 'status'],
    },
  },
};

// 执行 PDF 工具
async function executePdfTool(pdfId: string, toolName: string, args: any): Promise<string> {
  const pdfDir = path.join(PDF_DATA_DIR, pdfId);
  try {
    switch (toolName) {
      case 'get_pdf_outline': {
        const meta = JSON.parse(await fs.readFile(path.join(pdfDir, 'meta.json'), 'utf-8'));
        return meta.outline_text || '暂无目录信息，请先在页面上点击"AI 分析目录"';
      }
      case 'get_pdf_page': {
        const pages = JSON.parse(await fs.readFile(path.join(pdfDir, 'pages.json'), 'utf-8'));
        const page = pages.find((p: any) => p.page_number === args.page_number);
        return page ? `第 ${page.page_number} 页 (${page.char_count} 字):\n${page.text}` : `未找到第 ${args.page_number} 页`;
      }
      case 'get_pdf_pages': {
        const pages = JSON.parse(await fs.readFile(path.join(pdfDir, 'pages.json'), 'utf-8'));
        const result = pages
          .filter((p: any) => p.page_number >= args.start_page && p.page_number <= args.end_page)
          .map((p: any) => `--- 第 ${p.page_number} 页 ---\n${p.text}`);
        return result.join('\n\n') || '未找到指定页面';
      }
      case 'search_pdf': {
        const pages = JSON.parse(await fs.readFile(path.join(pdfDir, 'pages.json'), 'utf-8'));
        const matches = pages
          .filter((p: any) => p.text?.includes(args.keyword))
          .map((p: any) => `第 ${p.page_number} 页: ${p.text.substring(0, 200)}...`);
        return matches.length > 0 ? `找到 ${matches.length} 页包含"${args.keyword}":\n${matches.join('\n')}` : `未找到包含"${args.keyword}"的页面`;
      }
      case 'get_bid_info': {
        try {
          const bidInfo = JSON.parse(await fs.readFile(path.join(pdfDir, 'bid_info.json'), 'utf-8'));
          return JSON.stringify(bidInfo, null, 2);
        } catch { return '尚未进行 AI 拆解，请先在页面上点击"AI 拆解"'; }
      }
      default: return `未知工具: ${toolName}`;
    }
  } catch (e: any) {
    return `工具执行失败: ${e.message}`;
  }
}

// 构建响应计划的系统提示
function buildPlanPrompt(plan: ResponsePlan): string {
  const { summary, sections, unmappedRequirements } = plan;

  let prompt = `## 响应计划（自动填充指导）

以下是根据招标文件生成的响应计划。请严格按照此计划逐项填写文档。

### 计划概要
- 总需求数: ${summary.totalRequirements}
- 匹配模板章节: ${summary.mappedToTemplate}
- 需新建章节: ${summary.needsNewSection}
- 跳过: ${summary.skipped}

### 填写顺序
`;

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const sourceLabel = s.source === 'template' ? '模板已有' : '需新建';
    const statusMap: Record<string, string> = {
      'ready': '已有内容',
      'needs_content': '待填写',
      'needs_section': '待创建章节',
      'skipped': '跳过',
    };
    const statusLabel = statusMap[s.status] || s.status;

    prompt += `
#### 第${i + 1}步: ${s.sectionName}
- 来源: ${sourceLabel}
- 状态: ${statusLabel}
- 关联需求: ${s.requirements.join(', ') || '无'}
- 填写指导: ${s.notes}
`;
    if (s.source === 'create') {
      prompt += `- ⚠️ 此章节在模板中不存在，需要先用 superdoc_create 创建章节标题和框架，再填写内容\n`;
    }
    prompt += `- ✅ 本章节完成后，立即调用: report_progress({ section_id: "${s.id}", status: "done", summary: "已填写${s.sectionName}" })\n`;
  }

  if (unmappedRequirements.length > 0) {
    prompt += `
### 未匹配的需求
以下需求没有找到对应的模板章节，请在最相关的已有章节中响应，或在文档末尾补充：
${unmappedRequirements.join(', ')}
`;
  }

  prompt += `
### 重要规则
1. 按照上述顺序逐项填写
2. 对于"需新建"的章节，先用 superdoc_create 创建标题和段落框架，再填写内容
3. 所有公司信息（名称、资质、业绩、人员、产品参数、价格等）如果没有提供，标记为【待补充：xxx】
4. ★条款必须在对应章节中明确响应，不能遗漏
5. **每个章节完成后，必须立即调用该章节指定的 report_progress，不要等到最后一起报告**
6. 如果某个章节不需要填写或跳过，调用 report_progress({ section_id: "S-XX", status: "skipped" })
7. 填写完成后，告知用户完成了哪些章节，哪些需要人工补充`;

  return prompt;
}

export async function runAgent({
  message,
  history = [],
  pdfId,
  sessionId,
  modelConfig,
  emit,
  shouldStop,
  responsePlan,
  completedSteps,
  waitForToolResult,
}: AgentParams) {
  console.log(`[agent] 开始, model=${modelConfig.model}, pdfId=${pdfId || '无'}, sessionId=${sessionId || '无'}, plan=${responsePlan ? '有' : '无'}`);

  const openai = new OpenAI({ apiKey: modelConfig.apiKey, baseURL: modelConfig.baseURL });

  // 构建消息
  // 合并系统提示：自己的 + SuperDoc SDK 的 + 响应计划
  let systemPrompt = SYSTEM_PROMPT;
  if (sessionId) {
    try {
      const sdkPrompt = await getSystemPrompt();
      systemPrompt += '\n\n' + sdkPrompt;
    } catch (e: any) {
      console.error(`[agent] 加载 SuperDoc 系统提示失败: ${e.message}`);
    }
  }

  // 注入响应计划到系统提示
  if (responsePlan && responsePlan.sections.length > 0) {
    const planPrompt = buildPlanPrompt(responsePlan);
    systemPrompt += '\n\n' + planPrompt;
    console.log(`[agent] 已注入响应计划: ${responsePlan.sections.length} 个章节`);
  }

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message },
  ];

  // 响应计划进度跟踪
  const hasPlan = !!(responsePlan && responsePlan.sections.length > 0);

  // 合并工具：PDF 工具 + SuperDoc 工具 + 进度工具
  const tools: any[] = [];
  if (pdfId) tools.push(...PDF_TOOLS);
  if (hasPlan) tools.push(PROGRESS_TOOL);
  console.log(`[agent] pdfId=${pdfId || '无'}, sessionId=${sessionId || '无'}, PDF工具=${pdfId ? PDF_TOOLS.length : 0}个, plan=${hasPlan ? '有' : '无'}`);
  if (sessionId) {
    try {
      const superdocTools = await superdocService.getTools();
      tools.push(...superdocTools);
      console.log(`[agent] 已加载 ${superdocTools.length} 个 SuperDoc 工具`);
    } catch (e: any) {
      console.error(`[agent] 加载 SuperDoc 工具失败: ${e.message}`);
    }
  }

  if (tools.length === 0) {
    emit('reply', { content: '请先上传 PDF 招标文件或 Word 模板，我才能帮你查询或编辑。' });
    emit('done', {});
    return;
  }

  emit('status', { message: '正在思考...' });

  const MAX_CONSECUTIVE_FAILS = 20;  // 连续失败 20 次才停止
  const LLM_TIMEOUT_MS = 5 * 60 * 1000;  // 单次 LLM 调用超时：5 分钟
  const MAX_TIMEOUT_RETRIES = 3;  // 超时重试次数
  let consecutiveFails = 0;  // 连续失败计数

  // 恢复已完成的步骤进度，并找到下一个待执行步骤
  const planProgressMap = new Map<string, 'done' | 'skipped' | 'running' | 'pending'>();

  if (hasPlan) {
    const completedSet = new Set(completedSteps || []);
    let nextStepIdx = 0;

    for (let i = 0; i < responsePlan!.sections.length; i++) {
      const section = responsePlan!.sections[i];
      if (completedSet.has(section.id)) {
        planProgressMap.set(section.id, 'done');
        emit('plan_step_update', { sectionId: section.id, status: 'done' });
        nextStepIdx = i + 1;
      } else {
        planProgressMap.set(section.id, 'pending');
      }
    }

    // 标记下一个步骤为 running
    if (nextStepIdx < responsePlan!.sections.length) {
      planProgressMap.set(responsePlan!.sections[nextStepIdx].id, 'running');
      emit('plan_step_update', { sectionId: responsePlan!.sections[nextStepIdx].id, status: 'running' });
      console.log(`[agent] 从步骤 ${responsePlan!.sections[nextStepIdx].id} (${nextStepIdx + 1}/${responsePlan!.sections.length}) 继续`);
    }
  }

  // 生成当前进度摘要（每轮推理前注入）
  function buildProgressSummary(): string {
    if (!hasPlan) return '';
    const lines: string[] = ['## 当前填写进度'];
    for (const s of responsePlan!.sections) {
      const status = planProgressMap.get(s.id) || 'pending';
      const icon = status === 'done' ? '✅' : status === 'running' ? '🔄' : status === 'skipped' ? '⏭️' : '⬜';
      lines.push(`${icon} ${s.id} ${s.sectionName}`);
    }
    const doneCount = [...planProgressMap.values()].filter(v => v === 'done').length;
    lines.push(`\n进度: ${doneCount}/${responsePlan!.sections.length} 已完成`);
    const current = [...planProgressMap.entries()].find(([_, v]) => v === 'running');
    if (current) {
      lines.push(`当前正在填写: ${responsePlan!.sections.find(s => s.id === current[0])?.sectionName}`);
    }
    return lines.join('\n');
  }

  for (let round = 1; ; round++) {
    if (shouldStop?.()) { emit('status', { message: '已取消' }); break; }
    if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
      emit('status', { message: `连续失败 ${MAX_CONSECUTIVE_FAILS} 次，已停止` });
      break;
    }

    emit('turn_start', { round });
    emit('status', { message: `思考中（第${round}轮）...` });

    let content = '';
    let reasoningContent = '';
    const currentToolCalls: Record<string, any> = {};

    // 带超时的 LLM 调用，支持重试
    let llmSuccess = false;
    let timeoutRetries = 0;

    while (!llmSuccess && timeoutRetries < MAX_TIMEOUT_RETRIES) {
      if (shouldStop?.()) break;

      // 如果是重试，提示用户
      if (timeoutRetries > 0) {
        emit('status', { message: `第 ${timeoutRetries} 次重试（上次超时）...` });
        console.log(`[agent] LLM 超时重试 ${timeoutRetries}/${MAX_TIMEOUT_RETRIES}`);
      }

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log(`[agent] LLM 调用超时 (${LLM_TIMEOUT_MS / 1000}s)，正在取消...`);
        emit('status', { message: 'LLM 响应超时，正在重试...' });
        abortController.abort();
      }, LLM_TIMEOUT_MS);

      try {
        const temp = modelConfig.model.includes('moonshot') || modelConfig.model.includes('kimi') ? 1 : 0.3;

        // 注入当前进度摘要（不污染原始 messages）
        const progressSummary = buildProgressSummary();
        const messagesWithProgress = progressSummary
          ? [...messages, { role: 'system' as const, content: progressSummary }]
          : messages;

        console.log(`[agent] 调用 LLM, messages=${messagesWithProgress.length}, tools=${tools.length}`);
        const stream = await openai.chat.completions.create({
          model: modelConfig.model,
          messages: messagesWithProgress,
          tools,
          temperature: temp,
          stream: true,
        }, { signal: abortController.signal });

        let hasReceivedData = false;

        for await (const chunk of stream) {
          if (shouldStop?.()) break;
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta as any;

          if (delta?.reasoning_content || delta?.content || delta?.tool_calls) {
            hasReceivedData = true;
          }

          if (delta?.reasoning_content) {
            reasoningContent += delta.reasoning_content;
            emit('thought_delta', { text: delta.reasoning_content });
          }
          if (delta?.content) {
            content += delta.content;
            emit('token', { text: delta.content });
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!currentToolCalls[idx]) currentToolCalls[idx] = { id: '', name: '', arguments: '' };
              if (tc.id) currentToolCalls[idx].id = tc.id;
              if (tc.function?.name) currentToolCalls[idx].name += tc.function.name;
              if (tc.function?.arguments) currentToolCalls[idx].arguments += tc.function.arguments;
            }
          }
        }

        clearTimeout(timeoutId);
        llmSuccess = true;  // 流式读取完成，标记成功
      } catch (e: any) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError' || e.message?.includes('abort')) {
          // 超时被取消
          timeoutRetries++;
          console.warn(`[agent] LLM 调用超时 (${timeoutRetries}/${MAX_TIMEOUT_RETRIES})`);
          // 清空本轮已收集的部分内容，准备重试
          content = '';
          reasoningContent = '';
          for (const key in currentToolCalls) delete currentToolCalls[key];
          continue;
        }
        // 其他错误，直接失败
        emit('error', { message: `LLM 调用失败: ${e.message}` });
        consecutiveFails++;
        break;
      }
    }

    // 如果超时重试全部失败
    if (!llmSuccess && timeoutRetries >= MAX_TIMEOUT_RETRIES) {
      emit('reply', { content: `\n\n⚠️ LLM 连续 ${MAX_TIMEOUT_RETRIES} 次响应超时，已自动停止。请稍后重试。` });
      break;
    }

    if (shouldStop?.()) { emit('status', { message: '已取消' }); break; }

    const toolCalls = Object.values(currentToolCalls).filter((tc: any) => tc.name);

    // 无工具调用 → 最终回复
    if (toolCalls.length === 0) {
      if (content) emit('reply', { content });
      emit('status', { message: '完成' });
      break;
    }

    // 有工具调用 → 执行
    if (content) emit('thought', { content });

    messages.push({
      role: 'assistant',
      content,
      tool_calls: toolCalls.map((tc: any) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of toolCalls) {
      if (shouldStop?.()) break;

      const toolName = tc.name;
      let toolArgs: any = {};
      try { toolArgs = tc.arguments ? JSON.parse(tc.arguments) : {}; } catch { toolArgs = {}; }

      // 递归解析嵌套的 JSON 字符串（模型经常把对象序列化成字符串）
      function deepParseStrings(obj: any): any {
        if (typeof obj === 'string') {
          try {
            const parsed = JSON.parse(obj);
            if (typeof parsed === 'object' && parsed !== null) return deepParseStrings(parsed);
          } catch {}
          return obj;
        }
        if (Array.isArray(obj)) return obj.map(deepParseStrings);
        if (typeof obj === 'object' && obj !== null) {
          const result: any = {};
          for (const [k, v] of Object.entries(obj)) result[k] = deepParseStrings(v);
          return result;
        }
        return obj;
      }
      toolArgs = deepParseStrings(toolArgs);

      // 强制开启修改跟踪（仅 mutations 支持 changeMode）
      if (toolName === 'superdoc_mutations') {
        toolArgs.changeMode = 'tracked';
      }

      emit('tool_call_start', { name: toolName, args: toolArgs });

      let result: string;
      try {
        // 分发到对应的工具
        if (toolName === 'report_progress' && hasPlan) {
          // 进度报告工具：更新计划步骤状态
          const { section_id, status, summary } = toolArgs;
          const newStatus = status || 'done';
          planProgressMap.set(section_id, newStatus as any);
          emit('plan_step_update', { sectionId: section_id, status: newStatus, summary });

          // 自动标记下一个 pending 步骤为 running
          if (newStatus === 'done' || newStatus === 'skipped') {
            const nextSection = responsePlan!.sections.find(s => (planProgressMap.get(s.id) || 'pending') === 'pending');
            if (nextSection) {
              planProgressMap.set(nextSection.id, 'running');
              emit('plan_step_update', { sectionId: nextSection.id, status: 'running' });
            }
          }

          // 持久化已完成的步骤到 session
          if (sessionId) {
            const completed = [...planProgressMap.entries()]
              .filter(([_, v]) => v === 'done' || v === 'skipped')
              .map(([id]) => id);
            sessionManager.updateSessionMeta(sessionId, { completedSteps: completed }).catch(() => {});
          }

          result = `已记录章节 ${section_id} 状态: ${newStatus}`;
          console.log(`[agent] 进度报告: ${section_id} -> ${newStatus}`);
          consecutiveFails = 0;
        } else if (pdfId && PDF_TOOLS.some(t => t.function.name === toolName)) {
          result = await executePdfTool(pdfId, toolName, toolArgs);
          consecutiveFails = 0;  // 成功，重置失败计数
        } else if (sessionId && toolName.startsWith('superdoc_')) {
          // 前端代理模式：通过 SSE 发给前端执行，避免文档重新加载
          if (waitForToolResult) {
            result = await waitForToolResult(tc.id, toolName, toolArgs);
            console.log(`[agent] 前端执行完成: ${toolName}`);
          } else {
            // 后端执行模式（兼容）
            const toolResult = await superdocService.callTool(sessionId, toolName, toolArgs);
            result = JSON.stringify(toolResult);

            // 保存文档到磁盘
            try {
              const doc = await superdocService.getDoc(sessionId);
              const session = sessionManager.getSession(sessionId);
              if (doc && session) {
                await doc.save({ out: session.docPath, force: true });
                session.revision = (session.revision || 0) + 1;
                const blockId = toolResult?.target?.blockId
                  || toolResult?.steps?.[0]?.data?.resolutions?.[0]?.target?.blockId
                  || toolResult?.items?.[0]?.blocks?.[0]?.blockId
                  || null;
                emit('doc_checkpoint', { revision: session.revision, blockId });
                console.log(`[agent] 文档已保存, revision=${session.revision}`);
              }
            } catch (saveErr: any) {
              console.error(`[agent] 文档保存失败:`, saveErr.message);
            }
          }
          consecutiveFails = 0;  // 成功，重置失败计数
        } else {
          result = `未知工具: ${toolName}`;
        }
      } catch (e: any) {
        result = `工具执行失败: ${e.message}`;
        consecutiveFails++;
        console.error(`[agent] 工具 ${toolName} 失败(连续失败${consecutiveFails}次):`, e.message);
      }

      emit('tool_call_end', { name: toolName, args: toolArgs, result });

      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }

  // 检查是否达到最大轮数
  if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
    emit('reply', { content: `\n\n⚠️ 连续失败 ${MAX_CONSECUTIVE_FAILS} 次，已自动停止。请检查问题后重试。` });
  }

  emit('done', {});
}
 