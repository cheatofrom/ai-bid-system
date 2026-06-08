/**
 * 修改记录面板 - 显示 AI 的所有修改
 */

import { useState, useEffect, useCallback } from 'react';
import { Tag, Empty, Spin } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, EyeOutlined } from '@ant-design/icons';

interface TrackChange {
  id: string;
  type: string;
  author: string;
  excerpt: string;
}

interface Props {
  superdoc: any | null;
}

export default function TrackChangesPanel({ superdoc }: Props) {
  const [changes, setChanges] = useState<TrackChange[]>([]);
  const [loading, setLoading] = useState(false);

  // 刷新修改列表
  const refreshChanges = useCallback(() => {
    if (!superdoc) return;
    try {
      const doc = superdoc.doc || superdoc;
      if (doc?.trackChanges?.list) {
        const list = doc.trackChanges.list();
        setChanges(list.map((item: any) => ({
          id: item.id,
          type: item.type || 'unknown',
          author: item.author?.name || item.author?.email || '未知',
          excerpt: item.excerpt || '',
        })));
      }
    } catch (e) {
      // ignore
    }
  }, [superdoc]);

  // 定期刷新
  useEffect(() => {
    if (!superdoc) return;
    refreshChanges();
    const timer = setInterval(refreshChanges, 3000);
    return () => clearInterval(timer);
  }, [superdoc, refreshChanges]);

  // 滚动到指定修改
  const scrollToChange = useCallback((changeId: string) => {
    if (!superdoc) return;
    try {
      const ui = superdoc.ui || superdoc;
      if (ui?.viewport?.scrollIntoView) {
        ui.viewport.scrollIntoView({
          target: { kind: 'entity', entityType: 'trackedChange', entityId: changeId },
          block: 'center',
          behavior: 'smooth',
        });
      }
    } catch {}
  }, [superdoc]);

  // 接受修改
  const acceptChange = useCallback((changeId: string) => {
    if (!superdoc) return;
    try {
      const ui = superdoc.ui || superdoc;
      if (ui?.trackChanges?.accept) {
        ui.trackChanges.accept(changeId);
        setTimeout(refreshChanges, 500);
      }
    } catch {}
  }, [superdoc, refreshChanges]);

  // 拒绝修改
  const rejectChange = useCallback((changeId: string) => {
    if (!superdoc) return;
    try {
      const ui = superdoc.ui || superdoc;
      if (ui?.trackChanges?.reject) {
        ui.trackChanges.reject(changeId);
        setTimeout(refreshChanges, 500);
      }
    } catch {}
  }, [superdoc, refreshChanges]);

  if (!superdoc) return null;

  const typeLabel: Record<string, { text: string; color: string }> = {
    insert: { text: '插入', color: 'green' },
    delete: { text: '删除', color: 'red' },
    replacement: { text: '替换', color: 'orange' },
    format: { text: '格式', color: 'blue' },
  };

  return (
    <div style={{
      position: 'absolute',
      top: 8,
      right: 8,
      width: 240,
      maxHeight: '60%',
      background: '#fff',
      border: '1px solid #e8e8e8',
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      zIndex: 20,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 头部 */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
        fontWeight: 'bold',
        fontSize: 13,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>📝 修改记录</span>
        <Tag color="blue">{changes.length}</Tag>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        {changes.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无修改记录"
            style={{ padding: '20px 0' }}
          />
        ) : (
          changes.map((change) => {
            const tl = typeLabel[change.type] || { text: change.type, color: 'default' };
            return (
              <div
                key={change.id}
                style={{
                  padding: '6px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f5f5f5',
                  fontSize: 12,
                }}
                onClick={() => scrollToChange(change.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <Tag color={tl.color} style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                    {tl.text}
                  </Tag>
                  <span style={{ color: '#666', fontSize: 11 }}>{change.author}</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                    <EyeOutlined
                      style={{ color: '#1890ff', cursor: 'pointer', fontSize: 12 }}
                      onClick={(e) => { e.stopPropagation(); scrollToChange(change.id); }}
                    />
                    <CheckCircleOutlined
                      style={{ color: '#52c41a', cursor: 'pointer', fontSize: 12 }}
                      onClick={(e) => { e.stopPropagation(); acceptChange(change.id); }}
                    />
                    <CloseCircleOutlined
                      style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 12 }}
                      onClick={(e) => { e.stopPropagation(); rejectChange(change.id); }}
                    />
                  </span>
                </div>
                {change.excerpt && (
                  <div style={{ color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {change.excerpt.length > 50 ? change.excerpt.substring(0, 50) + '...' : change.excerpt}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
