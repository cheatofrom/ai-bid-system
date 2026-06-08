/** PDF 解析服务 — 调用 Python 后端，支持流式进度 */

export interface PageContent {
  pageNumber: number;
  text: string;
}

export interface PdfContent {
  text: string;
  pages: PageContent[];
  tables: never[];
  pageCount: number;
}

export interface PdfParseProgress {
  type: 'start' | 'progress' | 'done';
  total_pages?: number;
  total?: number;
  current?: number;
  page_text_preview?: string;
  text?: string;
  pages?: PageContent[];
  page_count?: number;
  char_count?: number;
}

const API_BASE = '/api';

/**
 * 上传并解析 PDF 文件（带进度回调）
 */
export async function parsePdf(
  file: File,
  onProgress?: (progress: PdfParseProgress) => void
): Promise<PdfContent> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/parse-pdf-stream`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'PDF 解析失败');
  }

  // 读取流式响应
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let result: PdfContent | null = null;

  if (reader) {
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 最后一行可能不完整

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data: PdfParseProgress = JSON.parse(line);
          onProgress?.(data);

          if (data.type === 'done') {
            result = {
              text: data.text || '',
              pages: (data.pages || []).map((p: any) => ({
                pageNumber: p.page_number ?? p.pageNumber ?? 0,
                text: p.text,
              })),
              tables: [],
              pageCount: data.page_count || 0,
            };
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }

  if (!result) {
    throw new Error('PDF 解析未返回结果');
  }

  return result;
}
