import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '.data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

export interface Session {
  sessionId: string;
  templatePath: string;
  docPath: string;
  originalPath: string;
  templateName: string;
  bidData: any;
  companyInfo: any;
  revision: number;
  doc?: any; // SuperDoc instance
  messages?: Array<{ role: string; content: string; timestamp?: number; collapsible?: any }>;
  pdfId?: string;
  completedSteps?: string[];
}

class SessionManager {
  private sessions: Map<string, Session> = new Map();

  constructor() {
    this.init();
  }

  private async init() {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    await this.loadSessions();
  }

  private async loadSessions() {
    try {
      const entries = await fs.readdir(SESSIONS_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const metaPath = path.join(SESSIONS_DIR, entry.name, 'meta.json');
          try {
            const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
            const docPath = path.join(SESSIONS_DIR, entry.name, 'current.docx');
            try {
              await fs.access(docPath);
              this.sessions.set(meta.sessionId, {
                ...meta,
                docPath,
                doc: null,
              });
              console.log(`[session] 加载会话: ${meta.sessionId} (${meta.templateName})`);
            } catch {
              // doc file doesn't exist, skip
            }
          } catch {
            // meta.json doesn't exist or invalid, skip
          }
        }
      }
    } catch {
      // sessions directory doesn't exist yet
    }
  }

  async createSession(templateContent: Buffer, templateName: string): Promise<Session> {
    const sessionId = uuidv4().substring(0, 8);
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    await fs.mkdir(sessionDir, { recursive: true });

    const originalPath = path.join(sessionDir, 'original.docx');
    const docPath = path.join(sessionDir, 'current.docx');

    await fs.writeFile(originalPath, templateContent);
    await fs.writeFile(docPath, templateContent);

    const session: Session = {
      sessionId,
      templatePath: docPath,
      docPath,
      originalPath,
      templateName,
      bidData: {},
      companyInfo: {},
      revision: 1,
      doc: null,
    };

    this.sessions.set(sessionId, session);

    // 保存元数据
    const meta = { ...session, doc: undefined };
    await fs.writeFile(
      path.join(sessionDir, 'meta.json'),
      JSON.stringify(meta, null, 2)
    );

    return session;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  async listSessions(): Promise<Array<{ sessionId: string; templateName: string; revision: number }>> {
    const result: Array<{ sessionId: string; templateName: string; revision: number }> = [];
    for (const session of this.sessions.values()) {
      try {
        await fs.access(session.docPath);
        result.push({
          sessionId: session.sessionId,
          templateName: session.templateName,
          revision: session.revision,
        });
      } catch {
        // doc file doesn't exist, skip
      }
    }
    return result;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {
      // ignore errors
    }
    return true;
  }

  // 更新会话元数据（消息、pdfId、bidData 等）
  async updateSessionMeta(sessionId: string, updates: { messages?: any[]; pdfId?: string; bidData?: any; completedSteps?: string[] }): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (updates.messages !== undefined) session.messages = updates.messages;
    if (updates.pdfId !== undefined) session.pdfId = updates.pdfId;
    if (updates.bidData !== undefined) session.bidData = updates.bidData;
    if (updates.completedSteps !== undefined) session.completedSteps = updates.completedSteps;

    // 持久化到磁盘
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    const metaPath = path.join(sessionDir, 'meta.json');
    try {
      const meta = { ...session, doc: undefined };
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
    } catch {}
  }

  // 获取会话详情（含消息历史）
  async getSessionDetail(sessionId: string): Promise<Session | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // 如果内存中没有消息，尝试从磁盘加载
    if (!session.messages) {
      try {
        const metaPath = path.join(SESSIONS_DIR, sessionId, 'meta.json');
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8'));
        session.messages = meta.messages || [];
        session.pdfId = meta.pdfId;
      } catch {
        session.messages = [];
      }
    }

    return session;
  }
}

export const sessionManager = new SessionManager();
