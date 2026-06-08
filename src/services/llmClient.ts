  /** 大模型调用客户端 — 调用 Python 后端 */

const API_BASE = '/api';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 调用大模型对话接口
 */
export async function chat(
  messages: ChatMessage[],
  options: { model?: string; temperature?: number } = {}
): Promise<string> {
  // 拼接 messages 为单个 prompt（后端 generate 接口只接收 prompt）
  const prompt = messages.map((m) => {
    if (m.role === 'system') return `[系统指令]\n${m.content}\n\n`;
    return m.content;
  }).join('');

  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model_key: options.model,
      temperature: options.temperature ?? 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'AI 调用失败');
  }

  const data = await res.json();
  return data.content;
}

/**
 * 调用大模型并解析 JSON 响应
 */
export async function chatJSON<T = any>(
  messages: ChatMessage[],
  options: { model?: string; temperature?: number } = {}
): Promise<T> {
  const prompt = messages.map((m) => {
    if (m.role === 'system') return `[系统指令]\n${m.content}\n\n`;
    return m.content;
  }).join('');

  const res = await fetch(`${API_BASE}/generate-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      model_key: options.model,
      temperature: options.temperature ?? 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'AI 调用失败');
  }

  return res.json();
}
