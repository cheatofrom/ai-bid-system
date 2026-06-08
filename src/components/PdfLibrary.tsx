import { useState, useEffect, useCallback } from 'react';
import { Button, Upload, Tag, Space, Progress, Tabs, Typography, message, Popconfirm, Modal, Input, Table, Badge, Tooltip } from 'antd';
import { UploadOutlined, FileTextOutlined, DeleteOutlined, RobotOutlined, ArrowLeftOutlined, EditOutlined, UnorderedListOutlined } from '@ant-design/icons';
import type { RequirementsList, Requirement } from '@/types/bid';
import { extractRequirements as apiExtractRequirements, getRequirements } from '@/services/api';

const { Title, Text, Paragraph } = Typography;

interface PdfItem {
  id: string;
  filename: string;
  size: number;
  uploaded_at: string;
  status: 'uploaded' | 'parsing' | 'parsed' | 'error';
  page_count: number;
  char_count: number;
  bid_info?: any;
  outline?: any[];
  requirements_count?: number;
}

interface PdfLibraryProps {
  onSelect?: (pdfId: string, bidInfo: any) => void;
  onBack?: () => void;
}

export default function PdfLibrary({ onSelect, onBack }: PdfLibraryProps) {
  const [pdfs, setPdfs] = useState<PdfItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPdf, setSelectedPdf] = useState<any>(null);
  const [parsingId, setParsingId] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState(0);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyzingOutline, setAnalyzingOutline] = useState(false);

  // 需求拆解状态
  const [requirementsList, setRequirementsList] = useState<RequirementsList | null>(null);
  const [extractingRequirements, setExtractingRequirements] = useState(false);
  const [streamText, setStreamText] = useState('');

  // 编辑弹窗状态
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editModalTitle, setEditModalTitle] = useState('');
  const [editModalContent, setEditModalContent] = useState('');
  const [editModalType, setEditModalType] = useState<'outline' | 'page'>('outline');
  const [editPageIndex, setEditPageIndex] = useState<number | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/pdf-library/list');
      const data = await resp.json();
      setPdfs(data.items || []);
    } catch (err) {
      console.error('加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // 选择文件
  const handleSelect = useCallback(async (pdfId: string) => {
    setSelectedId(pdfId);
    setRequirementsList(null);
    try {
      const resp = await fetch(`/api/pdf-library/${pdfId}`);
      const data = await resp.json();
      setSelectedPdf(data);

      // 加载已有需求清单
      if (data.bid_info) {
        getRequirements(pdfId).then(reqs => {
          if (reqs) setRequirementsList(reqs);
        });
      }
    } catch (err) {
      message.error('加载详情失败');
    }
  }, []);

  // 上传 PDF
  const handleUpload = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      await fetch('/api/pdf-library/upload', { method: 'POST', body: formData });
      message.success('上传成功');
      loadList();
    } catch (err) {
      message.error('上传失败');
    }
    return false;
  }, [loadList]);

  // 解析 PDF
  const handleParse = useCallback(async (pdfId: string) => {
    setParsingId(pdfId);
    setParseProgress(0);
    try {
      const resp = await fetch(`/api/pdf-library/${pdfId}/parse`, { method: 'POST' });
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
              setParseProgress(Math.round((event.current / event.total) * 100));
            } else if (event.type === 'done') {
              message.success(`解析完成: ${event.page_count} 页`);
            }
          } catch {}
        }
      }
      loadList();
      if (selectedId === pdfId) handleSelect(pdfId);
    } catch (err) {
      message.error('解析失败');
    } finally {
      setParsingId(null);
      setParseProgress(0);
    }
  }, [loadList, selectedId, handleSelect]);

  // AI 拆解
  const handleAnalyze = useCallback(async (pdfId: string) => {
    setAnalyzingId(pdfId);
    try {
      const resp = await fetch(`/api/pdf-library/${pdfId}/analyze`, { method: 'POST' });
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
            if (event.type === 'result') {
              message.success('AI 拆解完成');
            }
          } catch {}
        }
      }
      loadList();
      if (selectedId === pdfId) handleSelect(pdfId);
    } catch (err) {
      message.error('AI 拆解失败');
    } finally {
      setAnalyzingId(null);
    }
  }, [loadList, selectedId, handleSelect]);

  // 提取需求清单
  const handleExtractRequirements = useCallback(async (pdfId: string) => {
    setExtractingRequirements(true);
    setStreamText('');
    try {
      const result = await apiExtractRequirements(pdfId, (event, data) => {
        if (event === 'token' && data.text) {
          setStreamText(prev => prev + data.text);
        } else if (event === 'status') {
          // 状态更新
        } else if (event === 'error') {
          throw new Error(data.message);
        }
      });
      if (result) {
        setRequirementsList(result);
        message.success(`需求拆解完成，共 ${result.totalCount} 条需求`);
        loadList(); // 刷新列表显示需求计数
      }
    } catch (err: any) {
      message.error(`需求拆解失败: ${err.message}`);
    } finally {
      setExtractingRequirements(false);
      setStreamText('');
    }
  }, [loadList]);

  // AI 分析目录（流式）
  const [outlineStreamText, setOutlineStreamText] = useState('');

  const handleAnalyzeOutline = useCallback(async (pdfId: string) => {
    setAnalyzingOutline(true);
    setOutlineStreamText('');
    try {
      const resp = await fetch(`/api/pdf-library/${pdfId}/analyze-outline`, { method: 'POST' });

      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || '分析失败');
      }

      // 读取 SSE 流
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              if (currentEvent === 'token' && data.text) {
                setOutlineStreamText(prev => prev + data.text);
              } else if (currentEvent === 'done') {
                message.success('AI 目录分析完成');
                if (selectedId === pdfId) handleSelect(pdfId);
              } else if (currentEvent === 'error') {
                throw new Error(data.message);
              }
            } catch (e) {
              // ignore parse errors
            }
            currentEvent = '';
          }
        }
      }
    } catch (err: any) {
      message.error(`AI 目录分析失败: ${err.message}`);
    } finally {
      setAnalyzingOutline(false);
    }
  }, [selectedId, handleSelect]);

  // 删除 PDF
  const handleDelete = useCallback(async (pdfId: string) => {
    try {
      await fetch(`/api/pdf-library/${pdfId}`, { method: 'DELETE' });
      message.success('已删除');
      if (selectedId === pdfId) {
        setSelectedId(null);
        setSelectedPdf(null);
      }
      loadList();
    } catch (err) {
      message.error('删除失败');
    }
  }, [loadList, selectedId]);

  // 使用此 PDF
  const handleUse = useCallback((pdfId: string) => {
    const pdf = pdfs.find(p => p.id === pdfId);
    if (pdf?.bid_info && onSelect) {
      onSelect(pdfId, pdf.bid_info);
    } else {
      message.warning('请先进行 AI 拆解');
    }
  }, [pdfs, onSelect]);

  // 解析目录文本为条目列表
  const parseOutlineItems = useCallback((text: string) => {
    if (!text) return [];
    const lines = text.split('\n');
    const items: { title: string; page: number | null }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '目录') continue;
      // 匹配 "标题.....页码" 或 "标题 页码"
      const m = trimmed.match(/^(.+?)[\.\s]+(\d+)\s*$/);
      if (m) {
        items.push({ title: m[1].trim().replace(/\.+$/, ''), page: parseInt(m[2]) });
      }
    }
    return items;
  }, []);

  // 打开编辑弹窗 - 目录
  const handleEditOutline = useCallback(() => {
    setEditModalType('outline');
    setEditModalTitle('编辑目录');
    setEditModalContent(selectedPdf?.outline_text || '');
    setEditPageIndex(null);
    setEditModalOpen(true);
  }, [selectedPdf]);

  // 打开编辑弹窗 - 页面内容
  const handleEditPage = useCallback((pageIndex: number) => {
    if (!selectedPdf?.pages?.[pageIndex]) return;
    const page = selectedPdf.pages[pageIndex];
    setEditModalType('page');
    setEditModalTitle(`编辑第 ${page.page_number} 页内容`);
    setEditModalContent(page.text || '');
    setEditPageIndex(pageIndex);
    setEditModalOpen(true);
  }, [selectedPdf]);

  // 保存编辑内容
  const handleSaveEdit = useCallback(async () => {
    if (!selectedId) return;
    try {
      const body: any = {};
      if (editModalType === 'outline') {
        body.outline_text = editModalContent;
      } else if (editModalType === 'page' && editPageIndex !== null) {
        body.page_index = editPageIndex;
        body.page_text = editModalContent;
      }

      const resp = await fetch(`/api/pdf-library/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        message.success('保存成功');
        setEditModalOpen(false);
        handleSelect(selectedId);
      } else {
        message.error('保存失败');
      }
    } catch {
      message.error('保存失败');
    }
  }, [selectedId, editModalType, editPageIndex, editModalContent, handleSelect]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const statusTag = (status: string) => {
    const map: Record<string, { color: string; text: string }> = {
      uploaded: { color: 'blue', text: '已上传' },
      parsing: { color: 'orange', text: '解析中' },
      parsed: { color: 'green', text: '已解析' },
      error: { color: 'red', text: '错误' },
    };
    const s = map[status] || { color: 'default', text: status };
    return <Tag color={s.color}>{s.text}</Tag>;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 头部 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          {onBack && <Button icon={<ArrowLeftOutlined />} onClick={onBack} size="small">返回</Button>}
          <Text strong>📚 招标文件库</Text>
        </Space>
        <Upload accept=".pdf" showUploadList={false} beforeUpload={handleUpload}>
          <Button type="primary" icon={<UploadOutlined />} size="small">上传 PDF</Button>
        </Upload>
      </div>

      {/* 主体：左右布局 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：文件列表 */}
        <div style={{ width: 240, borderRight: '1px solid #f0f0f0', overflow: 'auto', padding: 8 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>加载中...</div>
          ) : pdfs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>暂无文件</div>
          ) : (
            pdfs.map(item => (
              <div
                key={item.id}
                onClick={() => handleSelect(item.id)}
                style={{
                  padding: '8px 10px',
                  marginBottom: 4,
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: selectedId === item.id ? '#e6f7ff' : '#fff',
                  border: selectedId === item.id ? '1px solid #91d5ff' : '1px solid transparent',
                }}
              >
                {/* 文件名 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <FileTextOutlined style={{ color: '#1890ff', flexShrink: 0 }} />
                  <Text ellipsis style={{ flex: 1, fontSize: 13 }}>{item.filename}</Text>
                </div>

                {/* 基本信息 */}
                <div style={{ fontSize: 11, color: '#999', marginBottom: 6, paddingLeft: 20 }}>
                  {formatSize(item.size)} · {item.page_count > 0 ? `${item.page_count}页` : '未解析'}
                  {item.char_count > 0 && ` · ${item.char_count}字`}
                </div>

                {/* 状态和按钮 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 20 }}>
                  {statusTag(item.status)}
                  {item.bid_info && <Tag color="purple">已拆解</Tag>}

                  {item.status === 'uploaded' && (
                    <Button size="small" type="link" onClick={(e) => { e.stopPropagation(); handleParse(item.id); }}>
                      解析
                    </Button>
                  )}
                  {item.status === 'parsed' && !item.bid_info && (
                    <Button size="small" type="link" icon={<RobotOutlined />} onClick={(e) => { e.stopPropagation(); handleAnalyze(item.id); }}>
                      拆解
                    </Button>
                  )}
                  {item.bid_info && (
                    <Button size="small" type="link" onClick={(e) => { e.stopPropagation(); handleUse(item.id); }}>
                      使用
                    </Button>
                  )}
                  <Popconfirm title="确定删除？" onConfirm={(e) => { e?.stopPropagation(); handleDelete(item.id); }}>
                    <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                  </Popconfirm>
                </div>

                {/* 解析进度 */}
                {parsingId === item.id && (
                  <Progress percent={parseProgress} size="small" style={{ marginTop: 4 }} />
                )}
              </div>
            ))
          )}
        </div>

        {/* 右侧：详情区域 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {!selectedPdf ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📄</div>
              <div>点击左侧文件查看详情</div>
            </div>
          ) : (
            <Tabs
              defaultActiveKey="basic"
              items={[
                {
                  key: 'basic',
                  label: '📄 基本信息',
                  children: (
                    <div>
                      <Title level={5}>{selectedPdf.filename}</Title>
                      <Space style={{ marginBottom: 16 }}>
                        <Tag>{selectedPdf.page_count} 页</Tag>
                        <Tag>{selectedPdf.char_count} 字</Tag>
                        {statusTag(selectedPdf.status)}
                      </Space>

                      {/* 目录 */}
                      <div style={{ marginTop: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <Text strong>📑 目录索引</Text>
                          <Space>
                            {selectedPdf.outline_text && (
                              <Button size="small" icon={<EditOutlined />} onClick={handleEditOutline}>编辑</Button>
                            )}
                            <Button
                              size="small"
                              icon={<RobotOutlined />}
                              onClick={() => handleAnalyzeOutline(selectedPdf.id)}
                              loading={analyzingOutline}
                            >
                              {analyzingOutline ? 'AI 分析中...' : 'AI 分析目录'}
                            </Button>
                          </Space>
                        </div>
                        {analyzingOutline ? (
                          <div style={{ background: '#f5f5f5', borderRadius: 6, padding: 12 }}>
                            <div style={{ fontSize: 12, color: '#1890ff', marginBottom: 8 }}>🤖 AI 正在分析目录...</div>
                            <pre style={{
                              maxHeight: 300,
                              overflow: 'auto',
                              fontSize: 12,
                              lineHeight: 1.6,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-all',
                              margin: 0,
                              fontFamily: 'inherit',
                            }}>
                              {outlineStreamText || '等待 AI 响应...'}
                            </pre>
                          </div>
                        ) : selectedPdf.outline_text ? (
                          <div>
                            <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>🤖 AI 提取的目录</div>
                            <pre
                              onClick={handleEditOutline}
                              style={{
                                maxHeight: 200,
                                overflow: 'auto',
                                background: '#fafafa',
                                padding: 12,
                                borderRadius: 6,
                                fontSize: 12,
                                lineHeight: 1.6,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                                cursor: 'pointer',
                                border: '1px solid transparent',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.border = '1px solid #91d5ff'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.border = '1px solid transparent'; }}
                            >
                              {selectedPdf.outline_text}
                            </pre>
                          </div>
                        ) : selectedPdf.outline && selectedPdf.outline.length > 0 ? (
                          <div>
                            <div style={{ maxHeight: 300, overflow: 'auto' }}>
                              {selectedPdf.outline.slice(0, 30).map((item: any, idx: number) => (
                                <div key={idx} style={{ padding: '4px 0', fontSize: 13 }}>
                                  <Tag>第{item.page}页</Tag> {item.title}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: '#999', fontSize: 12 }}>暂无目录，点击上方按钮让 AI 分析</div>
                        )}
                      </div>

                      {/* 页面预览 */}
                      {selectedPdf.pages && selectedPdf.pages.length > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <Text strong>📄 页面内容</Text>
                          <div style={{ marginTop: 8, maxHeight: 500, overflow: 'auto' }}>
                            {selectedPdf.pages.map((page: any, idx: number) => (
                              <div
                                key={idx}
                                onClick={() => handleEditPage(idx)}
                                style={{
                                  marginBottom: 8,
                                  padding: 10,
                                  background: '#fafafa',
                                  borderRadius: 6,
                                  cursor: 'pointer',
                                  border: '1px solid transparent',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.border = '1px solid #91d5ff'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.border = '1px solid transparent'; }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <Text type="secondary" style={{ fontSize: 11 }}>第 {page.page_number} 页 ({page.char_count} 字)</Text>
                                  <EditOutlined style={{ fontSize: 12, color: '#999' }} />
                                </div>
                                <div style={{ fontSize: 12, color: '#333', lineHeight: 1.6, maxHeight: 60, overflow: 'hidden' }}>
                                  {page.preview || page.text?.substring(0, 200) || '(空页)'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'ai',
                  label: '🤖 AI 拆解',
                  children: (
                    <div>
                      {!selectedPdf.bid_info ? (
                        <div style={{ textAlign: 'center', padding: 40 }}>
                          <div style={{ marginBottom: 16, color: '#999' }}>尚未进行 AI 拆解</div>
                          <Button
                            type="primary"
                            icon={<RobotOutlined />}
                            onClick={() => handleAnalyze(selectedPdf.id)}
                            loading={analyzingId === selectedPdf.id}
                          >
                            开始 AI 拆解
                          </Button>
                        </div>
                      ) : (
                        <div>
                          {/* 重新拆解按钮 */}
                          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                              icon={<RobotOutlined />}
                              onClick={() => handleAnalyze(selectedPdf.id)}
                              loading={analyzingId === selectedPdf.id}
                            >
                              重新拆解
                            </Button>
                          </div>

                          {/* 项目信息 */}
                          {selectedPdf.bid_info.projectInfo && (
                            <div style={{ marginBottom: 16 }}>
                              <Text strong>📋 项目信息</Text>
                              <div style={{ marginTop: 8 }}>
                                {selectedPdf.bid_info.projectInfo.projectName && (
                                  <div><Tag>项目名称</Tag> {selectedPdf.bid_info.projectInfo.projectName}</div>
                                )}
                                {selectedPdf.bid_info.projectInfo.projectCode && (
                                  <div><Tag>项目编号</Tag> {selectedPdf.bid_info.projectInfo.projectCode}</div>
                                )}
                                {selectedPdf.bid_info.projectInfo.purchaser && (
                                  <div><Tag>采购单位</Tag> {selectedPdf.bid_info.projectInfo.purchaser}</div>
                                )}
                                {selectedPdf.bid_info.projectInfo.budget && (
                                  <div><Tag>预算金额</Tag> {selectedPdf.bid_info.projectInfo.budget}</div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* ★条款 */}
                          {selectedPdf.bid_info.starClauses?.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                              <Text strong>⚠️ ★条款 ({selectedPdf.bid_info.starClauses.length} 条)</Text>
                              <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
                                {selectedPdf.bid_info.starClauses.map((clause: any, idx: number) => (
                                  <div key={idx} style={{ padding: 4, marginBottom: 4, background: '#fff2f0', borderRadius: 4, fontSize: 12 }}>
                                    {clause.content}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 技术参数 */}
                          {selectedPdf.bid_info.techParams?.length > 0 && (
                            <div style={{ marginBottom: 16 }}>
                              <Text strong>🔧 技术参数 ({selectedPdf.bid_info.techParams.length} 项)</Text>
                              <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto' }}>
                                {selectedPdf.bid_info.techParams.map((param: any, idx: number) => (
                                  <div key={idx} style={{ padding: 4, marginBottom: 4, fontSize: 12 }}>
                                    <Tag>{param.name}</Tag> {param.requirement}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 使用按钮 */}
                          <Button
                            type="primary"
                            onClick={() => handleUse(selectedPdf.id)}
                            style={{ marginTop: 16 }}
                          >
                            使用此招标信息
                          </Button>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'requirements',
                  label: '📋 需求清单',
                  children: (
                    <div>
                      {!selectedPdf.bid_info ? (
                        <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                          请先完成 AI 拆解
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <Text strong><UnorderedListOutlined /> 需求清单</Text>
                            <Button
                              type="primary"
                              icon={<RobotOutlined />}
                              onClick={() => handleExtractRequirements(selectedPdf.id)}
                              loading={extractingRequirements}
                              size="small"
                            >
                              {extractingRequirements ? '提取中...' : requirementsList ? '重新提取' : '提取需求'}
                            </Button>
                          </div>

                          {/* 提取进度 */}
                          {extractingRequirements && streamText && (
                            <div style={{ background: '#f5f5f5', borderRadius: 6, padding: 12, marginBottom: 12, maxHeight: 200, overflow: 'auto' }}>
                              <div style={{ fontSize: 12, color: '#1890ff', marginBottom: 8 }}>🤖 AI 正在提取需求...</div>
                              <pre style={{ margin: 0, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'inherit' }}>
                                {streamText}
                              </pre>
                            </div>
                          )}

                          {/* 需求列表 */}
                          {requirementsList && (
                            <div>
                              {/* 统计标签 */}
                              <Space wrap style={{ marginBottom: 12 }}>
                                <Tag color="red">critical: {requirementsList.categories.critical}</Tag>
                                <Tag color="orange">high: {requirementsList.categories.high}</Tag>
                                <Tag color="blue">medium: {requirementsList.categories.medium}</Tag>
                                <Tag color="default">low: {requirementsList.categories.low}</Tag>
                                <Tag>共 {requirementsList.totalCount} 条</Tag>
                              </Space>

                              {/* 需求表格 */}
                              <Table
                                size="small"
                                dataSource={requirementsList.requirements}
                                rowKey="id"
                                pagination={{ pageSize: 10, size: 'small' }}
                                columns={[
                                  {
                                    title: 'ID',
                                    dataIndex: 'id',
                                    width: 70,
                                    render: (id: string) => <Text code style={{ fontSize: 11 }}>{id}</Text>,
                                  },
                                  {
                                    title: '分类',
                                    dataIndex: 'category',
                                    width: 90,
                                    render: (cat: string) => {
                                      const colorMap: Record<string, string> = {
                                        starClause: 'red', techParam: 'blue', commercialTerm: 'green',
                                        document: 'purple', format: 'orange', qualification: 'cyan',
                                      };
                                      const labelMap: Record<string, string> = {
                                        starClause: '★条款', techParam: '技术参数', commercialTerm: '商务条款',
                                        document: '文档组成', format: '格式要求', qualification: '资质要求',
                                      };
                                      return <Tag color={colorMap[cat] || 'default'}>{labelMap[cat] || cat}</Tag>;
                                    },
                                  },
                                  {
                                    title: '内容',
                                    dataIndex: 'content',
                                    ellipsis: true,
                                    render: (text: string, record: Requirement) => (
                                      <Tooltip title={text}>
                                        <span>
                                          {record.isStar && <Badge status="error" text="" />}
                                          {text.length > 80 ? text.substring(0, 80) + '...' : text}
                                        </span>
                                      </Tooltip>
                                    ),
                                  },
                                  {
                                    title: '优先级',
                                    dataIndex: 'priority',
                                    width: 80,
                                    render: (p: string) => {
                                      const colorMap: Record<string, string> = {
                                        critical: 'red', high: 'orange', medium: 'blue', low: 'default',
                                      };
                                      return <Tag color={colorMap[p] || 'default'}>{p}</Tag>;
                                    },
                                  },
                                ]}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </div>
      </div>

      {/* 编辑弹窗 */}
      <Modal
        title={editModalTitle}
        open={editModalOpen}
        onCancel={() => setEditModalOpen(false)}
        onOk={handleSaveEdit}
        okText="保存"
        cancelText="取消"
        width={800}
      >
        <Input.TextArea
          value={editModalContent}
          onChange={(e) => setEditModalContent(e.target.value)}
          autoSize={{ minRows: 15, maxRows: 30 }}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
      </Modal>
    </div>
  );
}
