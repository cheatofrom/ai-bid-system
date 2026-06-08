import { createSuperDocClient, dispatchSuperDocTool, chooseTools, getSystemPrompt } from '@superdoc-dev/sdk';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME_DIR = path.join(__dirname, '..', '..', '.data', 'superdoc-home');

class SuperDocService {
  private client: any = null;
  private sessions: Map<string, any> = new Map();

  constructor() {
    this.init();
  }

  private async init() {
    await fs.mkdir(HOME_DIR, { recursive: true });
  }

  private async getClient() {
    if (!this.client) {
      this.client = createSuperDocClient({
        env: {
          HOME: HOME_DIR,
          XDG_CONFIG_HOME: path.join(HOME_DIR, '.config'),
          XDG_CACHE_HOME: path.join(HOME_DIR, '.cache'),
        },
        user: { name: '投标助手', email: 'assistant@bid.local' },
        defaultChangeMode: 'tracked',
      });
      await this.client.connect();
      console.log('[superdoc] SDK 客户端已连接（track changes 已启用）');
    }
    return this.client;
  }

  async open(sessionId: string, docPath: string): Promise<void> {
    const client = await this.getClient();

    // 关闭旧会话
    if (this.sessions.has(sessionId)) {
      try {
        await this.sessions.get(sessionId).close();
      } catch {}
    }

    const doc = await client.open({ doc: docPath, sessionId });
    this.sessions.set(sessionId, doc);
    console.log(`[superdoc] 文档已打开: ${sessionId}`);
  }

  async close(sessionId: string): Promise<void> {
    const doc = this.sessions.get(sessionId);
    if (doc) {
      await doc.close();
      this.sessions.delete(sessionId);
    }
  }

  async save(sessionId: string, outputPath: string): Promise<void> {
    const doc = await this.getDoc(sessionId);
    if (!doc) {
      throw new Error('会话不存在');
    }
    await doc.save({ out: outputPath, force: true });
  }

  // 获取文档句柄，如果内存中没有则自动重新打开
  async getDoc(sessionId: string): Promise<any> {
    let doc = this.sessions.get(sessionId);
    if (!doc) {
      // 自动恢复：从 sessionManager 获取路径并重新打开
      try {
        const { sessionManager } = await import('./session.js');
        const session = sessionManager.getSession(sessionId);
        if (session) {
          console.log(`[superdoc] 自动恢复会话: ${sessionId}`);
          await this.open(sessionId, session.docPath);
          doc = this.sessions.get(sessionId);
        }
      } catch (e: any) {
        console.error(`[superdoc] 自动恢复失败: ${e.message}`);
      }
    }
    return doc;
  }

  async callTool(sessionId: string, toolName: string, args: any): Promise<any> {
    const doc = await this.getDoc(sessionId);
    if (!doc) {
      throw new Error('会话不存在');
    }

    // 为缺少 action 的工具添加默认值
    let toolArgs = args || {};
    if (toolName === 'superdoc_get_content' && !toolArgs.action) {
      toolArgs = { action: 'text', ...toolArgs };
    }
    if (toolName === 'superdoc_edit' && !toolArgs.action) {
      toolArgs = { action: 'replace', ...toolArgs };
    }

    return await dispatchSuperDocTool(doc, toolName, toolArgs);
  }

  async getTools(): Promise<any[]> {
    const { tools } = await chooseTools({ provider: 'openai' });
    return tools;
  }
}

export const superdocService = new SuperDocService();
