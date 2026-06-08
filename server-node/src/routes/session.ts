import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { sessionManager } from '../services/session.js';
import { configService } from '../services/config.js';
import { superdocService } from '../services/superdoc.js';
import { runAgent } from '../services/agent.js';
import type { ResponsePlan } from '../services/requirements.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.join(__dirname, '..', '..', '.data', 'sessions');

const upload = multer({ storage: multer.memoryStorage() });
export const sessionRouter = Router();

// 跟踪活跃的 Agent 会话（用于取消）
const activeAgents = new Map<string, () => void>();

// 跟踪等待前端执行的工具调用（toolCallId -> resolve）
const pendingToolCalls = new Map<string, { resolve: (result: string) => void; reject: (err: Error) => void }>();

// 创建会话
sessionRouter.post('/create', upload.single('template'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: '请上传模板文件' });
    }

    // 修复中文文件名编码
    let filename = file.originalname;
    try {
      filename = Buffer.from(filename, 'latin1').toString('utf8');
    } catch {}

    const session = await sessionManager.createSession(file.buffer, filename);

    // 在 SuperDoc 中打开文档
    try {
      await superdocService.open(session.sessionId, session.docPath);
      console.log(`[session] SuperDoc 文档已打开: ${session.sessionId}`);
    } catch (e: any) {
      console.error(`[session] SuperDoc 打开失败: ${e.message}`);
    }

    res.json({
      sessionId: session.sessionId,
      revision: session.revision,
      docUrl: `/api/session/${session.sessionId}/docx?rev=${session.revision}`,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 列出会话
sessionRouter.get('/list', async (req: Request, res: Response) => {
  const sessions = await sessionManager.listSessions();
  res.json({ sessions });
});

// 删除会话
sessionRouter.delete('/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const deleted = await sessionManager.deleteSession(sessionId);
  if (!deleted) {
    return res.status(404).json({ error: '会话不存在' });
  }
  res.json({ ok: true });
});

// 清空所有会话
sessionRouter.delete('/', async (req: Request, res: Response) => {
  const sessions = await sessionManager.listSessions();
  let count = 0;
  for (const s of sessions) {
    if (await sessionManager.deleteSession(s.sessionId)) count++;
  }
  res.json({ ok: true, deleted: count });
});

// 获取文档
sessionRouter.get('/:sessionId/docx', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }

  res.sendFile(session.docPath);
});

// 获取会话详情（含消息历史）
sessionRouter.get('/:sessionId/detail', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = await sessionManager.getSessionDetail(sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }
  res.json({
    sessionId: session.sessionId,
    templateName: session.templateName,
    revision: session.revision,
    pdfId: session.pdfId || null,
    messages: session.messages || [],
    bidData: session.bidData || null,
    completedSteps: session.completedSteps || [],
  });
});

// 更新会话元数据（消息历史、pdfId、bidData）
sessionRouter.patch('/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const { messages, pdf_id, bid_data, completed_steps } = req.body;
  await sessionManager.updateSessionMeta(sessionId, {
    messages,
    pdfId: pdf_id,
    bidData: bid_data,
    completedSteps: completed_steps,
  });
  res.json({ ok: true });
});

// 获取响应计划
sessionRouter.get('/:sessionId/plan', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const planPath = path.join(SESSIONS_DIR, sessionId, 'response_plan.json');

  try {
    const data = JSON.parse(await fs.readFile(planPath, 'utf-8'));
    res.json(data);
  } catch {
    res.json(null);
  }
});

// AI 对话（SSE 流式）- 支持有无 PDF 两种模式
sessionRouter.put('/create', async (req: Request, res: Response) => {
  const { session_id, message, pdf_id, model_key, completed_steps } = req.body;

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 禁用 Nagle 算法，确保每次 write 立即发送
  if (res.socket) {
    res.socket.setNoDelay(true);
  }

  const emit = (event: string, data: any) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // 立即刷新，确保 SSE 事件实时推送到客户端
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    } catch (e) {
      console.log('[session] 写入失败，客户端可能已断开');
    }
  };

  let stopped = false;
  const agentKey = session_id || `anon_${Date.now()}`;

  // 注册取消回调
  activeAgents.set(agentKey, () => { stopped = true; });

  res.on('close', () => {
    console.log('[session] 响应关闭');
    stopped = true;
    activeAgents.delete(agentKey);
  });

  try {
    const modelConfig = configService.getModelConfig(model_key);

    // 加载响应计划（如果存在）
    let responsePlan: ResponsePlan | undefined;
    if (session_id) {
      try {
        const planPath = path.join(SESSIONS_DIR, session_id, 'response_plan.json');
        responsePlan = JSON.parse(await fs.readFile(planPath, 'utf-8'));
        console.log(`[session] 已加载响应计划: ${responsePlan!.sections.length} 个章节`);
      } catch {
        // 没有计划，正常流程
      }
    }

    console.log(`[session] Agent 请求: message="${message?.substring(0, 50)}", pdf_id=${pdf_id || '无'}, model=${modelConfig.model}, plan=${responsePlan ? '有' : '无'}`);

    // 前端工具代理：通过 SSE 发给前端执行，等待 POST 结果回来
    const waitForToolResult = session_id
      ? (toolCallId: string, toolName: string, toolArgs: any): Promise<string> => {
          return new Promise((resolve, reject) => {
            // 注册等待
            pendingToolCalls.set(toolCallId, { resolve, reject });

            // 通过 SSE 发给前端
            emit('tool_call_proxy', {
              toolCallId,
              toolName,
              toolArgs,
            });

            console.log(`[session] 等待前端执行: ${toolName} (${toolCallId})`);

            // 超时保护：60 秒
            setTimeout(() => {
              if (pendingToolCalls.has(toolCallId)) {
                pendingToolCalls.delete(toolCallId);
                reject(new Error(`前端工具执行超时: ${toolName}`));
              }
            }, 60_000);
          });
        }
      : undefined;

    // 运行 Agent - 不再强制要求 session
    await runAgent({
      message: message || '你好',
      pdfId: pdf_id,  // 可选
      sessionId: session_id,  // 可选，用于 SuperDoc 文档编辑
      modelConfig,
      emit,
      shouldStop: () => stopped,
      responsePlan,  // 可选，响应计划
      completedSteps: completed_steps,  // 已完成的步骤 ID 列表
      waitForToolResult,  // 前端工具代理
    });
  } catch (e: any) {
    emit('error', { message: e.message });
  } finally {
    activeAgents.delete(agentKey);
    res.end();
  }
});

// 前端保存文档到服务器
sessionRouter.post('/:sessionId/save-doc', upload.single('doc'), async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: '会话不存在' });
  }

  if (!req.file) {
    return res.status(400).json({ error: '缺少文档文件' });
  }

  try {
    await fs.writeFile(session.docPath, req.file.buffer);
    session.revision = (session.revision || 0) + 1;
    console.log(`[session] 文档已保存: ${sessionId}, revision=${session.revision}`);
    res.json({ ok: true, revision: session.revision });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 前端工具执行结果回调
sessionRouter.post('/tool-result', (req: Request, res: Response) => {
  const { toolCallId, result, error } = req.body;

  if (!toolCallId) {
    return res.status(400).json({ error: '缺少 toolCallId' });
  }

  const pending = pendingToolCalls.get(toolCallId);
  if (!pending) {
    console.warn(`[session] 收到未知工具结果: ${toolCallId}`);
    return res.json({ ok: false, message: '未找到等待中的工具调用' });
  }

  pendingToolCalls.delete(toolCallId);

  if (error) {
    pending.reject(new Error(error));
  } else {
    pending.resolve(typeof result === 'string' ? result : JSON.stringify(result));
  }

  console.log(`[session] 前端工具结果已收到: ${toolCallId}`);
  res.json({ ok: true });
});

// 取消 Agent
sessionRouter.post('/create/cancel', (req: Request, res: Response) => {
  const { session_id } = req.body;
  const key = session_id || Array.from(activeAgents.keys()).pop();

  if (key && activeAgents.has(key)) {
    activeAgents.get(key)!();
    activeAgents.delete(key);
    console.log(`[session] 已取消 Agent: ${key}`);
    res.json({ ok: true });
  } else {
    res.json({ ok: false, message: '没有正在运行的 Agent' });
  }
});
