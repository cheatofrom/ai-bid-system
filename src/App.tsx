import { useState, useCallback, useRef, useEffect } from 'react';
import { Typography, Button, Space, message, Select, Popconfirm } from 'antd';
import { SettingOutlined, DatabaseOutlined, DeleteOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { DocEditorHandle } from '@/components/DocEditor';
import type { BidInfo, ResponsePlan } from '@/types/bid';
import { getDefaultModel } from '@/config/modelConfig';
import { loadAllFonts } from '@/utils/fontUtils';
import DocEditor from '@/components/DocEditor';
import ChatPanel from '@/components/ChatPanel';
import PdfLibrary from '@/components/PdfLibrary';
import SettingsModal from '@/components/SettingsModal';
import { createSession, runAgent, cancelAgent, getPlan, generatePlan as apiGeneratePlan, submitToolResult, saveDocToServer } from '@/services/api';

const { Text } = Typography;

type PageMode = 'chat' | 'library';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  collapsible?: {
    summary: string;
    detail: string;
  };
}

interface RunPlanStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

interface SessionInfo {
  sessionId: string;
  templateName: string;
  revision: number;
}

const EDITOR_USER = { name: '投标助手', email: 'assistant@bid.local' };

export default function App() {
  // 页面模式
  const [pageMode, setPageMode] = useState<PageMode>('chat');

  // 文档状态
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  // 上传状态
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [bidData, setBidData] = useState<BidInfo | null>(null);
  const [selectedPdfId, setSelectedPdfId] = useState<string | null>(null);
  const [responsePlan, setResponsePlan] = useState<ResponsePlan | null>(null);

  // Agent 状态
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const msgIdCounter = useRef(0);
  // 保持 ref 与 state 同步
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // 自动保存消息到后端（防抖，消息变化后 2 秒保存）
  useEffect(() => {
    if (!sessionId || messages.length === 0) return;
    const timer = setTimeout(() => {
      fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, pdf_id: selectedPdfId, bid_data: bidData }),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [messages, sessionId, selectedPdfId, bidData]);
  const [isRunning, setIsRunning] = useState(false);
  const [runPlan, setRunPlan] = useState<RunPlanStep[]>([]);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planStreamText, setPlanStreamText] = useState('');
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const superdocRef = useRef<any>(null);  // 前端 SuperDoc 实例
  const docEditorRef = useRef<DocEditorHandle>(null);  // DocEditor 组件引用

  // UI 状态
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  // 分栏宽度
  const [leftWidth, setLeftWidth] = useState(420);
  const isDragging = useRef(false);

  useEffect(() => { loadAllFonts(); }, []);

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    try {
      const resp = await fetch('/api/session/list');
      const data = await resp.json();
      setSessions(data.sessions || []);
    } catch (err) {
      console.error('加载会话列表失败:', err);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // 加载已有会话（恢复完整状态）
  const handleLoadSession = useCallback(async (sid: string) => {
    setSessionId(sid);
    try {
      const resp = await fetch(`/api/session/${sid}/detail`);
      const data = await resp.json();
      setDocUrl(`/api/session/${sid}/docx?rev=${data.revision || 1}`);
      // 恢复消息历史
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages);
        // 更新消息 ID 计数器，避免和已有 ID 冲突
        const maxId = data.messages.reduce((max: number, m: any) => {
          const num = parseInt(m.id?.replace('msg_', '') || '0', 10);
          return isNaN(num) ? max : Math.max(max, num);
        }, 0);
        msgIdCounter.current = maxId;
      } else {
        setMessages([]);
        addMessage('system', '已加载历史会话');
      }
      // 恢复 PDF 选择
      if (data.pdfId) {
        setSelectedPdfId(data.pdfId);
      }
      // 恢复招标数据
      if (data.bidData) {
        setBidData(data.bidData);
      }
      // 恢复响应计划
      const plan = await getPlan(sid);
      console.log('[loadSession] plan:', plan ? `${plan.sections?.length} sections` : 'null');
      if (plan && plan.sections) {
        setResponsePlan(plan);
        // 恢复已完成的步骤
        const completedSet = new Set(data.completedSteps || []);
        const steps = plan.sections.map(s => ({
          id: s.id,
          label: `${s.sectionName} (${s.source === 'template' ? '模板已有' : '需新建'})`,
          status: (completedSet.has(s.id) ? 'done' : 'pending') as 'done' | 'pending',
        }));
        setRunPlan(steps);
      } else {
        setResponsePlan(null);
        setRunPlan([]);
      }
    } catch (err) {
      console.error('[loadSession] error:', err);
      setDocUrl(`/api/session/${sid}/docx?rev=1`);
      setMessages([]);
      setResponsePlan(null);
      setRunPlan([]);
      addMessage('system', '已加载历史会话');
    }
  }, []);

  // 删除会话
  const handleDeleteSession = useCallback(async (sid: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await fetch(`/api/session/${sid}`, { method: 'DELETE' });
      message.success('会话已删除');
      if (sessionId === sid) {
        setSessionId(null);
        setDocUrl(null);
      }
      loadSessions();
    } catch {
      message.error('删除失败');
    }
  }, [sessionId, loadSessions]);

  // 清空所有会话
  const handleClearSessions = useCallback(async () => {
    try {
      const resp = await fetch('/api/session', { method: 'DELETE' });
      const data = await resp.json();
      message.success(`已清空 ${data.deleted} 个会话`);
      setSessionId(null);
      setDocUrl(null);
      loadSessions();
    } catch {
      message.error('清空失败');
    }
  }, [loadSessions]);

  // 从招标文件库选择 PDF
  const handleSelectPdf = useCallback((pdfId: string, bidInfo: any) => {
    setSelectedPdfId(pdfId);
    setBidData(bidInfo);
    setPageMode('chat');
    addMessage('system', `已从文件库加载招标信息`);
    // 保存到当前会话
    if (sessionId) {
      fetch(`/api/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_id: pdfId, bid_data: bidInfo }),
      }).catch(() => {});
    }
  }, [sessionId]);

  // 响应计划生成完成
  const handlePlanGenerated = useCallback((plan: ResponsePlan) => {
    setResponsePlan(plan);
    // 将计划章节映射为 runPlan
    const steps = plan.sections.map(s => ({
      id: s.id,
      label: `${s.sectionName} (${s.source === 'template' ? '模板已有' : '需新建'})`,
      status: 'pending' as const,
    }));
    setRunPlan(steps);
    addMessage('system', `响应计划已生成：${plan.sections.length} 个章节，${plan.summary.needsNewSection} 个需新建`);
  }, []);

  // 在主界面生成响应计划
  const handleGeneratePlan = useCallback(async () => {
    if (!selectedPdfId || !sessionId) return;
    setGeneratingPlan(true);
    setPlanStreamText('');
    try {
      const result = await apiGeneratePlan(selectedPdfId, sessionId, (event, data) => {
        if (event === 'token' && data.text) {
          setPlanStreamText(prev => prev + data.text);
        } else if (event === 'error') {
          throw new Error(data.message);
        }
      });
      if (result) {
        handlePlanGenerated(result);
      }
    } catch (err: any) {
      addMessage('system', `生成响应计划失败: ${err.message}`);
    } finally {
      setGeneratingPlan(false);
      setPlanStreamText('');
    }
  }, [selectedPdfId, sessionId, handlePlanGenerated]);

  // 处理 Word 模板上传 - 立即创建会话并预览
  const handleTemplateUpload = useCallback(async (file: File) => {
    setTemplateFile(file);
    addMessage('system', `已选择模板: ${file.name}`);

    // 立即上传模板并获取预览
    try {
      const session = await createSession(file, bidData || {}, {});
      setSessionId(session.sessionId);
      setDocUrl(session.docUrl);
      setRevision(session.revision);
      addMessage('system', '模板已加载，可在右侧预览');
      // 保存 pdfId 到会话
      if (selectedPdfId) {
        fetch(`/api/session/${session.sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pdf_id: selectedPdfId }),
        }).catch(() => {});
      }
      loadSessions(); // 刷新会话列表
    } catch (err: any) {
      addMessage('system', `模板加载失败: ${err.message}`);
    }
  }, [bidData]);

  // 开始 AI 对话
  const handleStartAgent = useCallback(async (userMessage?: string) => {
    setIsRunning(true);
    setLastUserMessage(userMessage || '你好');
    let hasStreamedTokens = false;

    try {
      addMessage('user', userMessage || '你好');

      const TOOL_NAME_MAP: Record<string, string> = {
        'get_pdf_outline': '📑 查看目录',
        'get_pdf_page': '📄 查看页面',
        'get_pdf_pages': '📄 查看多页',
        'search_pdf': '🔍 搜索文档',
        'get_bid_info': '📋 获取分析结果',
        'superdoc_get_content': '📖 读取文档内容',
        'superdoc_search': '🔍 搜索文档',
        'superdoc_edit': '✏️ 编辑文档',
        'superdoc_format': '🎨 格式化',
        'superdoc_create': '➕ 创建内容',
        'superdoc_list': '📝 列表操作',
        'superdoc_comment': '💬 评论',
        'superdoc_track_changes': '📋 修订追踪',
        'superdoc_mutations': '🔄 批量编辑',
      };

      const formatJson = (value: any): string => {
        if (value === null || value === undefined) return 'null';
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value, null, 2);
        } catch {
          return String(value);
        }
      };

      // 计算已完成的步骤 ID 列表（用于恢复进度）
      const completedStepIds = runPlan.filter(s => s.status === 'done').map(s => s.id);

      await runAgent(sessionId, userMessage, selectedPdfId || undefined, (event, data) => {
        switch (event) {
          case 'start':
            addMessage('system', '🚀 Agent 开始执行...');
            break;
          case 'turn_start':
            addMessage('system', `🔄 第 ${data.round} 轮推理`);
            break;
          case 'status':
            // 更新状态消息
            break;
          case 'thought':
            if (data.content) {
              addCollapsibleMessage('💭 思考', data.content);
            }
            break;
          case 'thought_delta':
            if (data.text) {
              appendThought(data.text);
            }
            break;
          case 'reply':
            if (data.content && !hasStreamedTokens) {
              addMessage('assistant', data.content);
            }
            break;
          case 'token':
            if (data.text) {
              hasStreamedTokens = true;
              appendReply(data.text);
            }
            break;
          case 'tool_call_start':
            // 不在这里显示，等 tool_call_end 合并显示
            break;
          case 'tool_call_end':
            {
              const toolLabel = TOOL_NAME_MAP[data.name] || data.name;
              const hasArgs = data.args && Object.keys(data.args).length > 0;
              const argsStr = hasArgs ? `📥 请求参数:\n${formatJson(data.args)}\n\n` : '';
              const resultStr = formatJson(data.result);
              // 截断过长的结果，避免页面卡顿
              const maxLen = 2000;
              const displayResult = resultStr.length > maxLen
                ? resultStr.substring(0, maxLen) + '\n... (已截断)'
                : resultStr;
              addCollapsibleMessage(
                `🔧 ${toolLabel}`,
                `${argsStr}📤 返回结果:\n${displayResult}`
              );
            }
            break;
          case 'doc_checkpoint':
            // 文档已保存到磁盘，记录 revision，但不刷新编辑器（避免闪烁）
            if (data.revision) {
              setRevision(data.revision);
            }
            // 如果有 blockId，等文档加载后滚动到该位置
            if (data.blockId) {
              const bid = data.blockId;
              setTimeout(() => {
                const editorEl = document.querySelector('[class*="superdoc"]') || document.querySelector('.superdoc-editor');
                if (editorEl) {
                  const blockEl = editorEl.querySelector(`[data-block-id="${bid}"]`)
                    || editorEl.querySelector(`[data-node-id="${bid}"]`)
                    || editorEl.querySelector(`[data-id="${bid}"]`);
                  if (blockEl) {
                    blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }
              }, 1500);
            }
            break;
          case 'done':
            // 完成，保存文档和会话元数据
            if (sessionId) {
              (async () => {
                // 保存文档到服务器（不触发浏览器下载）
                try {
                  const inst = superdocRef.current;
                  if (inst?.export) {
                    const blob = await inst.export({ triggerDownload: false });
                    await saveDocToServer(sessionId, blob);
                    console.log('[frontend] 文档已保存到服务器');
                  }
                } catch (e) {
                  console.error('[frontend] 文档保存失败:', e);
                }
                // 保存会话元数据
                const completedSteps = runPlan.filter(s => s.status === 'done').map(s => s.id);
                fetch(`/api/session/${sessionId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ messages: messagesRef.current, pdf_id: selectedPdfId, bid_data: bidData, completed_steps: completedSteps }),
                }).catch(() => {});
              })();
            }
            break;
          case 'error':
            addMessage('system', `❌ 错误: ${data.message}`);
            break;
          case 'plan_step_update':
            if (data.sectionId && data.status) {
              updatePlanStep(data.sectionId, data.status);
              // 章节完成时，自动滚动到最新修改
              if (data.status === 'done' && docEditorRef.current) {
                setTimeout(() => {
                  try {
                    const changes = docEditorRef.current!.listChanges();
                    console.log('[auto-focus] listChanges result:', changes.length, 'items');
                    if (changes.length > 0) {
                      const lastChange = changes[changes.length - 1];
                      console.log('[auto-focus] last change:', JSON.stringify(lastChange));
                      docEditorRef.current!.scrollToChange(lastChange.id).then(() => {
                        console.log('[auto-focus] scroll done');
                      }).catch(e => console.error('[auto-focus] scroll error:', e));
                    } else {
                      console.log('[auto-focus] no changes found, trying nextChange');
                      const nextId = docEditorRef.current!.nextChange();
                      console.log('[auto-focus] nextChange result:', nextId);
                      if (nextId) docEditorRef.current!.scrollToChange(nextId);
                    }
                  } catch (e) {
                    console.error('[auto-focus] error:', e);
                  }
                }, 1000);
              }
            }
            break;
          case 'tool_call_proxy':
            // 前端工具代理：在本地 SuperDoc 实例上执行工具调用
            (async () => {
              const { toolCallId, toolName, toolArgs } = data;
              try {
                const superdoc = superdocRef.current;
                if (!superdoc) throw new Error('编辑器未就绪');

                const doc = superdoc.doc || superdoc.activeEditor?.doc;
                if (!doc) throw new Error('Document API 不可用');

                // 工具名 → Document API 方法的映射（与 SDK 的 dispatchIntentTool 逻辑一致）
                const TOOL_MAP: Record<string, (args: any) => any> = {
                  'superdoc_get_content': (args) => {
                    const { action, ...rest } = args;
                    const map: Record<string, () => any> = {
                      'text': () => doc.getText(rest),
                      'markdown': () => doc.getMarkdown(rest),
                      'html': () => doc.getHtml(rest),
                      'info': () => doc.info(rest),
                      'extract': () => doc.extract(rest),
                      'blocks': () => doc.blocks?.list?.(rest) || doc.getText(rest),
                    };
                    return (map[action] || map['text'])();
                  },
                  'superdoc_edit': (args) => {
                    const { action, ...rest } = args;
                    const map: Record<string, () => any> = {
                      'insert': () => doc.insert(rest),
                      'replace': () => doc.replace(rest),
                      'delete': () => doc.delete(rest),
                      'undo': () => doc.history?.undo?.(rest),
                      'redo': () => doc.history?.redo?.(rest),
                    };
                    return (map[action] || map['replace'])();
                  },
                  'superdoc_format': (args) => {
                    const { action, ...rest } = args;
                    if (action === 'inline') return doc.format?.apply?.(rest);
                    if (action === 'set_style') return doc.styles?.paragraph?.setStyle?.(rest);
                    if (action === 'set_alignment') return doc.format?.paragraph?.setAlignment?.(rest);
                    return doc.format?.apply?.(rest);
                  },
                  'superdoc_create': (args) => doc.insert(args),
                  'superdoc_list': (args) => doc.lists?.[args.action]?.(args) || doc.insert(args),
                  'superdoc_comment': (args) => doc.comments?.[args.action]?.(args),
                  'superdoc_track_changes': (args) => doc.trackChanges?.[args.action]?.(args),
                  'superdoc_mutations': (args) => doc.mutations?.apply?.(args) || doc.replace(args),
                  'superdoc_search': (args) => doc.search?.(args) || doc.getText(args),
                };

                const handler = TOOL_MAP[toolName];
                if (!handler) throw new Error(`未知工具: ${toolName}`);

                const toolResult = await handler(toolArgs || {});
                console.log(`[frontend] 工具执行完成: ${toolName}`, toolResult);

                // 提交结果给后端
                await submitToolResult(toolCallId, toolResult);
              } catch (err: any) {
                console.error(`[frontend] 工具执行失败: ${toolName}`, err);
                await submitToolResult(toolCallId, null, err.message);
              }
            })();
            break;
        }
      }, completedStepIds);
    } catch (err: any) {
      addMessage('system', `Agent 执行失败: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  }, [sessionId, selectedPdfId, runPlan]);

  // 取消 Agent
  const handleCancel = useCallback(async () => {
    if (sessionId) {
      await cancelAgent(sessionId);
      setIsRunning(false);
      addMessage('system', '已取消 Agent');
    }
  }, [sessionId]);

  // 重新生成（重新发送上一条用户消息）
  const handleRegenerate = useCallback(async () => {
    if (lastUserMessage && !isRunning) {
      addMessage('system', '🔄 重新生成...');
      await handleStartAgent(lastUserMessage);
    }
  }, [lastUserMessage, isRunning, handleStartAgent]);

  // 生成唯一消息 ID
  const nextMsgId = useCallback(() => `msg_${++msgIdCounter.current}`, []);

  // 添加消息
  const addMessage = useCallback((role: 'user' | 'assistant' | 'system', content: string) => {
    const msg: Message = { id: nextMsgId(), role, content, timestamp: Date.now() };
    setMessages(prev => [...prev, msg]);
  }, [nextMsgId]);

  // 添加可折叠消息（用于工具调用、思考等）
  const addCollapsibleMessage = useCallback((summary: string, detail: string) => {
    const msg: Message = {
      id: nextMsgId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      collapsible: { summary, detail },
    };
    setMessages(prev => [...prev, msg]);
  }, []);

  // 追加思考内容到最后一个可折叠消息（实时流式）
  const appendThought = useCallback((text: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.collapsible?.summary === '💭 思考') {
        return [
          ...prev.slice(0, -1),
          { ...last, collapsible: { ...last.collapsible, detail: last.collapsible.detail + text } },
        ];
      } else {
        const msg: Message = {
          id: nextMsgId(),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          collapsible: { summary: '💭 思考', detail: text },
        };
        return [...prev, msg];
      }
    });
  }, [nextMsgId]);

  // 追加回复内容到最后一个助手消息（实时流式）
  const appendReply = useCallback((text: string) => {
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && last.content && !last.collapsible) {
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + text },
        ];
      } else {
        const msg: Message = {
          id: nextMsgId(),
          role: 'assistant',
          content: text,
          timestamp: Date.now(),
        };
        return [...prev, msg];
      }
    });
  }, [nextMsgId]);

  // 更新计划步骤
  const updatePlanStep = useCallback((id: string, status: RunPlanStep['status']) => {
    setRunPlan(prev => prev.map(step => step.id === id ? { ...step, status } : step));
  }, []);

  // 导出文档
  const handleExport = useCallback(async () => {
    if (!docUrl) return;
    try {
      const response = await fetch(docUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `投标文件_${sessionId || 'export'}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch {
      message.error('导出失败');
    }
  }, [docUrl, sessionId]);

  // 拖拽调整分栏宽度
  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        setLeftWidth(Math.max(320, Math.min(e.clientX, window.innerWidth - 400)));
      }
    };
    const handleMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部栏 */}
      <div style={{
        height: 48,
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        flexShrink: 0,
      }}>
        <Space>
          <Text strong style={{ fontSize: 16 }}>标书 Agent 填写系统</Text>
          <Button
            icon={<DatabaseOutlined />}
            type={pageMode === 'library' ? 'primary' : 'default'}
            onClick={() => setPageMode(pageMode === 'library' ? 'chat' : 'library')}
          >
            招标文件库
          </Button>
          {sessions.length > 0 && (
            <>
              <Select
                placeholder="历史会话"
                style={{ width: 200 }}
                value={sessionId || undefined}
                onChange={handleLoadSession}
                options={sessions.map(s => ({
                  value: s.sessionId,
                  label: (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{(s.templateName || '').length > 10 ? (s.templateName || '').substring(0, 10) + '...' : (s.templateName || '未命名')}</span>
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => handleDeleteSession(s.sessionId, e)}
                        style={{ marginLeft: 8 }}
                      />
                    </div>
                  ),
                }))}
                allowClear
                size="small"
              />
              <Popconfirm title="确定清空所有会话？" onConfirm={handleClearSessions}>
                <Button size="small" danger>清空</Button>
              </Popconfirm>
            </>
          )}
        </Space>
        <Space>
          {!getDefaultModel().apiKey && <Text type="warning" style={{ fontSize: 12 }}>⚠️ 未配置 API Key</Text>}
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} size="small">设置</Button>
        </Space>
      </div>

      {/* 主体区域 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {pageMode === 'library' ? (
          // 招标文件库模式：PdfLibrary 占据整个主体
          <PdfLibrary
            onSelect={handleSelectPdf}
            onBack={() => setPageMode('chat')}
          />
        ) : (
          // 聊天模式：左右分栏
          <>
            {/* 左栏 */}
            <div style={{ width: leftWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #f0f0f0' }}>
              <ChatPanel
                messages={messages}
                isRunning={isRunning}
                runPlan={runPlan}
                templateFile={templateFile}
                bidData={bidData}
                selectedPdfId={selectedPdfId}
                onTemplateUpload={handleTemplateUpload}
                onSend={handleStartAgent}
                onCancel={handleCancel}
                onRegenerate={handleRegenerate}
                onExport={handleExport}
                onGeneratePlan={handleGeneratePlan}
                hasDoc={!!docUrl}
                responsePlan={responsePlan}
                generatingPlan={generatingPlan}
                planStreamText={planStreamText}
                canRegenerate={!!lastUserMessage && !isRunning}
              />
            </div>

            {/* 分隔条 */}
            <div
              style={{ width: 8, cursor: 'col-resize', background: '#f0f0f0', flexShrink: 0 }}
              onMouseDown={handleMouseDown}
            />

            {/* 右栏：SuperDoc 编辑器 */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              {/* 修改导航按钮 */}
              {docUrl && (
                <div style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 30,
                  display: 'flex',
                  gap: 4,
                }}>
                  <Button
                    size="small"
                    icon={<LeftOutlined />}
                    onClick={() => {
                      const id = docEditorRef.current?.prevChange();
                      if (id) docEditorRef.current?.scrollToChange(id);
                    }}
                    title="上一个修改"
                  />
                  <Button
                    size="small"
                    icon={<RightOutlined />}
                    onClick={() => {
                      const id = docEditorRef.current?.nextChange();
                      if (id) docEditorRef.current?.scrollToChange(id);
                    }}
                    title="下一个修改"
                  />
                </div>
              )}
              {docUrl ? (
                <DocEditor
                  ref={docEditorRef}
                  key={sessionId || 'new'}
                  document={docUrl}
                  documentMode="suggesting"
                  role="editor"
                  user={EDITOR_USER}
                  height="100%"
                  onReady={(e) => { superdocRef.current = e.superdoc; }}
                />
              ) : (
                <div style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#fafafa',
                  color: '#999',
                }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
                    <div style={{ fontSize: 16 }}>请先上传 Word 模板</div>
                    <div style={{ fontSize: 12, marginTop: 8, color: '#bbb' }}>
                      Agent 填写完成后，文档将在此处预览
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 设置弹窗 */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
