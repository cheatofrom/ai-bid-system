/** 统一 API 客户端 */

import type { RequirementsList, ResponsePlan } from '@/types/bid';

const API_BASE = '';

export interface SessionCreateResponse {
  sessionId: string;
  revision: number;
  docUrl: string;
}

export interface AgentEvent {
  event: string;
  data: any;
}

/** 创建会话：上传 Word 模板 + PDF 资料 */
export async function createSession(
  template: File,
  bidData: object,
  companyInfo: object,
): Promise<SessionCreateResponse> {
  const formData = new FormData();
  formData.append('template', template);
  formData.append('bid_data', JSON.stringify(bidData));
  formData.append('company_info', JSON.stringify(companyInfo));

  const response = await fetch(`${API_BASE}/api/session/create`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || '创建会话失败');
  }

  return response.json();
}

/** 解析 SSE 块 */
function parseSseChunk(buffer: string) {
  const parts = buffer.split('\n\n');
  const complete = parts.slice(0, -1);
  const rest = parts[parts.length - 1] ?? '';
  const events: Array<{ event: string; data: any }> = [];

  for (const raw of complete) {
    const lines = raw.split('\n');
    const eventLine = lines.find((l) => l.startsWith('event:'));
    const dataLine = lines.find((l) => l.startsWith('data:'));
    if (!eventLine || !dataLine) continue;
    const event = eventLine.slice('event:'.length).trim();
    const dataRaw = dataLine.slice('data:'.length).trim();
    try {
      const data = JSON.parse(dataRaw);
      events.push({ event, data });
    } catch {
      // ignore malformed event
    }
  }

  return { events, rest };
}

/** 让出主线程给浏览器绘制 */
const yieldToPaint = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

/** 执行 Agent 对话（SSE 流式） */
export async function runAgent(
  sessionId: string | null,
  message?: string,
  pdfId?: string | null,
  onEvent?: (event: string, data: any) => void,
  completedSteps?: string[],
): Promise<void> {
  console.log('[SSE] 开始连接, sessionId:', sessionId, 'pdfId:', pdfId);
  const response = await fetch(`${API_BASE}/api/session/create`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      pdf_id: pdfId,
      completed_steps: completedSteps,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Agent 调用失败');
  }

  console.log('[SSE] 连接成功，开始读取流');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      console.log('[SSE] 流结束，共收到', eventCount, '个事件');
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;

    for (const ev of events) {
      eventCount++;
      console.log('[SSE] 收到事件:', ev.event, ev.data);
      onEvent?.(ev.event, ev.data);
      // 让浏览器有机会更新 UI
      await yieldToPaint();
    }
  }
}

/** 取消 Agent */
export async function cancelAgent(sessionId: string): Promise<void> {
  await fetch(`${API_BASE}/api/session/create/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

/** 获取文档 URL */
export function getDocUrl(sessionId: string, rev?: number): string {
  const params = rev ? `?rev=${rev}` : '';
  return `${API_BASE}/api/session/${sessionId}/docx${params}`;
}

/** 解析 PDF（流式） */
export async function parsePdf(
  file: File,
  onProgress?: (current: number, total: number) => void,
): Promise<any> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/api/pdf/parse-stream`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('PDF 解析失败');
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'progress') {
          onProgress?.(event.current, event.total);
        } else if (event.type === 'done') {
          result = event;
        }
      } catch {
        // ignore
      }
    }
  }

  return result;
}

/** AI 拆解（流式） */
export async function analyzeBid(
  text: string,
  modelKey?: string,
  onEvent?: (event: any) => void,
): Promise<any> {
  const response = await fetch(`${API_BASE}/api/analyze-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_key: modelKey }),
  });

  if (!response.ok) {
    throw new Error('AI 拆解失败');
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        onEvent?.(event);
        if (event.type === 'result') {
          result = event.data;
        }
      } catch {
        // ignore
      }
    }
  }

  return result;
}

/** 提取需求清单（SSE 流式） */
export async function extractRequirements(
  pdfId: string,
  onEvent?: (event: string, data: any) => void,
): Promise<RequirementsList | null> {
  const response = await fetch(`${API_BASE}/api/pdf-library/${pdfId}/extract-requirements`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '需求拆解失败');
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: RequirementsList | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;

    for (const ev of events) {
      onEvent?.(ev.event, ev.data);
      if (ev.event === 'result' && ev.data?.data) {
        result = ev.data.data;
      }
    }
  }

  return result;
}

/** 获取已提取的需求清单 */
export async function getRequirements(pdfId: string): Promise<RequirementsList | null> {
  try {
    const response = await fetch(`${API_BASE}/api/pdf-library/${pdfId}/requirements`);
    return await response.json();
  } catch {
    return null;
  }
}

/** 生成响应计划（SSE 流式） */
export async function generatePlan(
  pdfId: string,
  sessionId: string,
  onEvent?: (event: string, data: any) => void,
): Promise<ResponsePlan | null> {
  const response = await fetch(`${API_BASE}/api/pdf-library/${pdfId}/generate-plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify({ session_id: sessionId }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '生成响应计划失败');
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ResponsePlan | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;

    for (const ev of events) {
      onEvent?.(ev.event, ev.data);
      if (ev.event === 'result' && ev.data?.data) {
        result = ev.data.data;
      }
    }
  }

  return result;
}

/** 获取已生成的响应计划 */
export async function getPlan(sessionId: string): Promise<ResponsePlan | null> {
  try {
    const response = await fetch(`${API_BASE}/api/session/${sessionId}/plan`);
    return await response.json();
  } catch {
    return null;
  }
}

/** 提交前端工具执行结果给后端 */
export async function submitToolResult(toolCallId: string, result?: any, error?: string): Promise<void> {
  await fetch(`${API_BASE}/api/session/tool-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolCallId, result, error }),
  });
}

/** 保存前端文档到服务器 */
export async function saveDocToServer(sessionId: string, docBlob: Blob): Promise<void> {
  const formData = new FormData();
  formData.append('doc', docBlob, 'current.docx');
  await fetch(`${API_BASE}/api/session/${sessionId}/save-doc`, {
    method: 'POST',
    body: formData,
  });
}
