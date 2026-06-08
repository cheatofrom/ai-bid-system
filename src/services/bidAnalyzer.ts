/** 招标文件拆解服务 — 调用 Python 后端 */

import type { PdfContent } from './pdfParser';
import type { BidInfo } from '@/types/bid';

const API_BASE = '/api';

/**
 * 分析招标文件，提取结构化信息
 * 大文本可能需要较长时间，设置 5 分钟超时
 */
export async function analyzeBid(
  pdfContent: PdfContent,
  onProgress?: (msg: string) => void
): Promise<BidInfo> {
  onProgress?.('正在发送到 AI 分析...');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5分钟超时

  try {
    const res = await fetch(`${API_BASE}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: pdfContent.text }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || '招标拆解失败');
    }

    onProgress?.('正在解析 AI 返回结果...');
    const data = await res.json();

    // 补充原始文本
    data.rawText = pdfContent.text;

    return data as BidInfo;
  } finally {
    clearTimeout(timeout);
  }
}
