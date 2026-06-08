import { useState, useRef, useEffect } from 'react';
import { Button, Input, Space, Upload, Tag, Progress } from 'antd';
import { UploadOutlined, SendOutlined, StopOutlined, DownloadOutlined, ThunderboltOutlined, BranchesOutlined, ReloadOutlined } from '@ant-design/icons';
import type { BidInfo, ResponsePlan } from '@/types/bid';

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

export interface RunPlanStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
}

interface ChatPanelProps {
  messages: Message[];
  isRunning: boolean;
  runPlan: RunPlanStep[];
  templateFile: File | null;
  bidData: BidInfo | null;
  selectedPdfId: string | null;
  onTemplateUpload: (file: File) => void;
  onSend: (message?: string) => void;
  onCancel: () => void;
  onRegenerate: () => void;
  onExport: () => void;
  onGeneratePlan: () => void;
  hasDoc: boolean;
  responsePlan?: ResponsePlan | null;
  generatingPlan?: boolean;
  planStreamText?: string;
  canRegenerate?: boolean;
}

export default function ChatPanel({
  messages,
  isRunning,
  runPlan,
  templateFile,
  bidData,
  selectedPdfId,
  onTemplateUpload,
  onSend,
  onCancel,
  onRegenerate,
  onExport,
  onGeneratePlan,
  hasDoc,
  responsePlan,
  generatingPlan,
  planStreamText,
  canRegenerate,
}: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const [planExpanded, setPlanExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息
  const handleSend = () => {
    if (isRunning) return;
    onSend(inputValue || undefined);
    setInputValue('');
  };

  // 计算计划进度
  const doneCount = runPlan.filter(s => s.status === 'done').length;
  const runningIdx = runPlan.findIndex(s => s.status === 'running');
  const planProgress = runPlan.length > 0
    ? Math.round((doneCount / runPlan.length) * 100)
    : 0;

  // 判断是否可以生成计划
  const canGeneratePlan = !!selectedPdfId && !!templateFile;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 上传区 */}
      <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {/* Word 模板上传 */}
          <Upload
            accept=".docx,.doc"
            showUploadList={false}
            beforeUpload={(file) => {
              onTemplateUpload(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} block>
              {templateFile
                ? `模板: ${templateFile.name.length > 10 ? templateFile.name.substring(0, 10) + '...' : templateFile.name}`
                : '上传投标模板 Word'}
            </Button>
          </Upload>

          {/* 已提取信息标签 */}
          {bidData && (
            <Space wrap>
              {bidData.projectInfo?.projectName && (
                <Tag color="green">{bidData.projectInfo.projectName}</Tag>
              )}
              {bidData.starClauses?.length > 0 && (
                <Tag color="red">{bidData.starClauses.length} 条★条款</Tag>
              )}
              {bidData.techParams?.length > 0 && (
                <Tag color="blue">{bidData.techParams.length} 项技术参数</Tag>
              )}
            </Space>
          )}

          {/* 生成响应计划按钮 */}
          {selectedPdfId && !responsePlan && (
            <>
              <Button
                icon={<BranchesOutlined />}
                onClick={onGeneratePlan}
                loading={generatingPlan}
                disabled={!canGeneratePlan}
                block
              >
                {generatingPlan ? '正在生成响应计划...' : canGeneratePlan ? '生成响应计划' : '请先上传模板'}
              </Button>
              {/* 生成进度 */}
              {generatingPlan && planStreamText && (
                <div style={{
                  background: '#f5f5f5',
                  borderRadius: 6,
                  padding: '8px 10px',
                  maxHeight: 150,
                  overflow: 'auto',
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: '#333',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                  🤖 {planStreamText}
                </div>
              )}
            </>
          )}

          {/* 响应计划 - 标题栏 + 下拉面板 */}
          {responsePlan && (
            <div style={{ position: 'relative' }}>
              {/* 标题栏 */}
              <div
                onClick={() => setPlanExpanded(!planExpanded)}
                style={{
                  background: '#f6ffed',
                  border: '1px solid #b7eb8f',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 12,
                  zIndex: 101,
                }}
              >
                <Space size={4}>
                  <span>{planExpanded ? '▼' : '▶'}</span>
                  <span style={{ fontWeight: 'bold' }}>📋 响应计划</span>
                  <Tag color="green" style={{ fontSize: 10 }}>{responsePlan.sections.length} 章节</Tag>
                </Space>
                <Space size={4}>
                  {runPlan.length > 0 && (
                    <Tag color={planProgress === 100 ? 'green' : 'blue'} style={{ fontSize: 10 }}>
                      {doneCount}/{runPlan.length}
                    </Tag>
                  )}
                  {runPlan.length > 0 && isRunning && (
                    <Progress percent={planProgress} size="small" status="active" style={{ width: 60 }} />
                  )}
                </Space>
              </div>

              {/* 下拉面板 */}
              {planExpanded && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  height: 280,
                  background: '#fff',
                  border: '1px solid #d9d9d9',
                  borderRadius: 6,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  zIndex: 100,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  fontSize: 12,
                  marginTop: 2,
                }}>
              {/* 头部 */}
              <div style={{
                padding: '8px 10px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <Space wrap size={4}>
                  <Tag color="green" style={{ fontSize: 10 }}>模板匹配: {responsePlan.summary.mappedToTemplate}</Tag>
                  <Tag color="orange" style={{ fontSize: 10 }}>需新建: {responsePlan.summary.needsNewSection}</Tag>
                </Space>
                <span style={{ color: '#999', fontSize: 10 }}>{doneCount}/{runPlan.length}</span>
              </div>

              {/* 章节列表 */}
              <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
                {responsePlan.sections.map((section, idx) => {
                  const step = runPlan.find(s => s.id === section.id);
                  const status = step?.status || 'pending';
                  return (
                    <div
                      key={section.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        opacity: status === 'pending' && runningIdx >= 0 && idx < runningIdx ? 0.5 : 1,
                      }}
                    >
                      <span style={{ flexShrink: 0 }}>
                        {status === 'done' && <span style={{ color: '#52c41a' }}>✓</span>}
                        {status === 'running' && <span style={{ color: '#1890ff' }}>◉</span>}
                        {status === 'pending' && <span style={{ color: '#d9d9d9' }}>○</span>}
                        {status === 'error' && <span style={{ color: '#ff4d4f' }}>✗</span>}
                      </span>
                      <span style={{
                        flex: 1,
                        color: status === 'done' ? '#52c41a' : status === 'running' ? '#1890ff' : '#333',
                        fontWeight: status === 'running' ? 'bold' : 'normal',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {section.sectionName}
                      </span>
                      <Tag
                        color={section.source === 'template' ? 'green' : 'orange'}
                        style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', flexShrink: 0 }}
                      >
                        {section.source === 'template' ? '已有' : '新建'}
                      </Tag>
                    </div>
                  );
                })}
              </div>

              {/* 操作按钮 */}
              <div style={{ padding: '8px 10px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
                {hasDoc && !isRunning && (
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    onClick={() => { onSend('请按照响应计划开始填写投标文件。从第1步开始。'); setPlanExpanded(false); }}
                    size="small"
                    style={{ flex: 1 }}
                  >
                    ⚡ 一键填写
                  </Button>
                )}
                <Button
                  icon={<BranchesOutlined />}
                  onClick={(e) => { e.stopPropagation(); onGeneratePlan(); }}
                  loading={generatingPlan}
                  size="small"
                >
                  重新生成
                </Button>
              </div>
            </div>
              )}
            </div>
          )}

          {/* 导出按钮 */}
          {hasDoc && (
            <Button icon={<DownloadOutlined />} onClick={onExport} block>
              导出填写完成的文档
            </Button>
          )}
        </Space>
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {messages.filter((msg, idx, arr) => arr.findIndex(m => m.id === msg.id) === idx).map(msg => (
          <div
            key={msg.id}
            style={{
              marginBottom: 12,
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            {/* 可折叠消息（工具调用、思考等） */}
            {msg.collapsible ? (
              <details style={{
                width: '100%',
                background: msg.collapsible.summary.startsWith('🔧') ? '#f0f5ff' :
                           msg.collapsible.summary.startsWith('💭') ? '#f6ffed' : '#fafafa',
                border: msg.collapsible.summary.startsWith('🔧') ? '1px solid #adc6ff' :
                       msg.collapsible.summary.startsWith('💭') ? '1px solid #b7eb8f' : '1px solid #d9d9d9',
                borderRadius: 8,
                overflow: 'hidden',
              }}>
                <summary style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 'bold',
                  color: '#333',
                  background: msg.collapsible.summary.startsWith('🔧') ? '#e6f0ff' :
                             msg.collapsible.summary.startsWith('💭') ? '#f0f9e8' : '#f5f5f5',
                }}>
                  {msg.collapsible.summary}
                </summary>
                <pre style={{
                  margin: 0,
                  padding: '8px 12px',
                  fontSize: 11,
                  color: '#333',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 300,
                  overflow: 'auto',
                  fontFamily: 'Consolas, Monaco, monospace',
                  lineHeight: 1.5,
                }}>
                  {msg.collapsible.detail}
                </pre>
              </details>
            ) : (
              <div style={{
                maxWidth: '85%',
                padding: '8px 12px',
                borderRadius: 8,
                background: msg.role === 'user' ? '#1890ff' : msg.role === 'system' ? '#f0f0f0' : '#fff',
                color: msg.role === 'user' ? '#fff' : '#333',
                border: msg.role === 'assistant' ? '1px solid #e8e8e8' : 'none',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {msg.content}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div style={{ padding: 12, borderTop: '1px solid #f0f0f0' }}>
        {/* 重新生成按钮 */}
        {canRegenerate && !isRunning && (
          <div style={{ marginBottom: 8, textAlign: 'center' }}>
            <Button icon={<ReloadOutlined />} onClick={onRegenerate} size="small">
              🔄 重新生成
            </Button>
          </div>
        )}
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onPressEnter={handleSend}
            placeholder={isRunning ? 'Agent 运行中...' : '输入指令，或点击上方一键填写'}
            disabled={isRunning}
          />
          {isRunning ? (
            <Button icon={<StopOutlined />} onClick={onCancel} danger>停止</Button>
          ) : (
            <Button type="primary" icon={<SendOutlined />} onClick={handleSend}>发送</Button>
          )}
        </Space.Compact>
      </div>
    </div>
  );
}
