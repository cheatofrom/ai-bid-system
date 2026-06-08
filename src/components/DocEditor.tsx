/**
 * SuperDoc 编辑器封装组件
 */

import { useRef, useEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Spin, message } from 'antd';

import { SuperDocEditor as SuperDocEditorComponent } from '@superdoc-dev/react';
import '@superdoc-dev/react/style.css';
import type { SuperDocRef, SuperDocReadyEvent, SuperDocEditorUpdateEvent } from '@superdoc-dev/react';

export interface DocEditorHandle {
  getInstance: () => any | null;
  exportDocx: () => Promise<void>;
  getContent: () => Promise<string>;
  scrollToChange: (changeId: string) => Promise<void>;
  nextChange: () => string | null;
  prevChange: () => string | null;
  listChanges: () => any[];
}

interface Props {
  document: File | string;
  documentUrl?: string;
  documentMode?: 'editing' | 'viewing' | 'suggesting';
  onUpdate?: (event: SuperDocEditorUpdateEvent) => void;
  onReady?: (event: SuperDocReadyEvent) => void;
  height?: number | string;
  role?: 'editor' | 'viewer';
  user?: { name: string; email: string };
  modules?: Record<string, any>;
}

const DocEditor = forwardRef<DocEditorHandle, Props>(
  ({ document: docFile, documentUrl, documentMode = 'editing', onUpdate, onReady, height = 600, role, user, modules }, ref) => {
    const superDocRef = useRef<SuperDocRef>(null);
    const [loading, setLoading] = useState(true);
    const [docSource, setDocSource] = useState<string | File | null>(null);
    const [error, setError] = useState<string | null>(null);

    // 保存/恢复滚动位置，避免文档更新后跳到顶部
    const savedScrollRef = useRef<{ top: number; left: number } | null>(null);

    useEffect(() => {
      // 保存当前滚动位置
      const container = containerRef.current;
      if (container && docSource) {
        savedScrollRef.current = {
          top: container.scrollTop,
          left: container.scrollLeft,
        };
      }

      if (documentUrl) { setDocSource(documentUrl); return; }
      const globalUrl = (window as any).__DOC_URL__;
      if (globalUrl) { setDocSource(globalUrl); return () => { delete (window as any).__DOC_URL__; }; }
      if (docFile instanceof File) {
        if (docFile.size > 0) {
          const url = URL.createObjectURL(docFile);
          setDocSource(url);
          return () => { URL.revokeObjectURL(url); };
        } else { setDocSource(null); }
      } else if (typeof docFile === 'string') { setDocSource(docFile); }
    }, [docFile, documentUrl]);

    // 文档加载后恢复滚动位置
    useEffect(() => {
      if (!loading && savedScrollRef.current) {
        const container = containerRef.current;
        if (container) {
          requestAnimationFrame(() => {
            container.scrollTop = savedScrollRef.current!.top;
            container.scrollLeft = savedScrollRef.current!.left;
            savedScrollRef.current = null;
          });
        }
      }
    }, [loading]);

    // 跟踪当前导航索引
    const changeNavIdx = useRef(0);

    useImperativeHandle(ref, () => ({
      getInstance: () => superDocRef.current?.getInstance() ?? null,
      exportDocx: async () => {
        const inst = superDocRef.current?.getInstance();
        if (!inst) { message.error('编辑器未就绪'); return; }
        try { await inst.export({ triggerDownload: true }); message.success('DOCX 已导出'); }
        catch { message.error('导出失败'); }
      },
      getContent: async () => {
        const inst = superDocRef.current?.getInstance() as any;
        if (!inst) return '';
        try {
          if (typeof inst.getText === 'function') return await inst.getText();
          if (typeof inst.getMarkdown === 'function') return await inst.getMarkdown();
          return '';
        } catch { return ''; }
      },
      // 获取所有修改记录
      listChanges: () => {
        const inst = superDocRef.current?.getInstance() as any;
        const doc = inst?.doc || inst?.activeEditor?.doc;
        if (!doc?.trackChanges?.list) return [];
        try { return doc.trackChanges.list()?.items || []; } catch { return []; }
      },
      // 滚动到指定修改
      scrollToChange: async (changeId: string) => {
        const inst = superDocRef.current?.getInstance() as any;
        if (!inst) return;
        try {
          // 尝试多种方式定位
          if (inst.scrollToElement) {
            const result = await inst.scrollToElement(changeId);
            if (result === false) {
              // scrollToElement 失败，尝试用 DOM 查找
              const el = document.querySelector(`[data-track-change-id="${changeId}"]`)
                || document.querySelector(`[data-change-id="${changeId}"]`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }
          }
        } catch (e) { console.warn('scrollToChange failed:', e); }
      },
      // 下一个修改
      nextChange: () => {
        const inst = superDocRef.current?.getInstance() as any;
        const doc = inst?.doc || inst?.activeEditor?.doc;
        if (!doc?.trackChanges?.list) return null;
        try {
          const items = doc.trackChanges.list()?.items || [];
          if (items.length === 0) return null;
          changeNavIdx.current = (changeNavIdx.current + 1) % items.length;
          return items[changeNavIdx.current]?.id || null;
        } catch { return null; }
      },
      // 上一个修改
      prevChange: () => {
        const inst = superDocRef.current?.getInstance() as any;
        const doc = inst?.doc || inst?.activeEditor?.doc;
        if (!doc?.trackChanges?.list) return null;
        try {
          const items = doc.trackChanges.list()?.items || [];
          if (items.length === 0) return null;
          changeNavIdx.current = (changeNavIdx.current - 1 + items.length) % items.length;
          return items[changeNavIdx.current]?.id || null;
        } catch { return null; }
      },
    }));

    const handleReady = useCallback((e: SuperDocReadyEvent) => {
      setLoading(false); setError(null);
      // 强制刷新修改标记显示（DOCX 加载后需要重新触发渲染）
      try {
        const sd = e.superdoc;
        if (sd?.setDocumentMode) {
          // 先切到 viewing 再切回 suggesting，强制重新渲染 tracked changes
          sd.setDocumentMode('viewing');
          setTimeout(() => {
            sd.setDocumentMode('suggesting');
          }, 100);
        }
      } catch {}
      onReady?.(e);
    }, [onReady]);

    const handleContentError = useCallback((err: any) => {
      setLoading(false); setError(err?.message || '加载文档失败');
    }, []);

    const handleException = useCallback((err: any) => {
      console.error('SuperDoc exception:', err);
    }, []);

    const handleUpdate = useCallback((e: SuperDocEditorUpdateEvent) => { onUpdate?.(e); }, [onUpdate]);

    // 稳定的 modules 配置，避免每次渲染创建新对象导致编辑器重新初始化
    const stableModules = useMemo(() => ({
      trackChanges: { visible: true, mode: 'review' as const },
      ...modules,
    }), [modules]);

    // 将 SuperDoc 内部的 toolbar 提升到滚动容器直接子级，使 sticky 生效
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      // 等 SuperDoc 渲染完成后查找 toolbar
      const timer = setInterval(() => {
        const toolbar = container.querySelector('.superdoc-toolbar') as HTMLElement | null;
        if (toolbar && toolbar.parentElement !== container) {
          container.insertBefore(toolbar, container.firstChild);
          clearInterval(timer);
        }
      }, 200);
      return () => clearInterval(timer);
    }, [docSource]);

    if (!docSource) {
      return <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin tip="准备文档中..." /></div>;
    }
    if (error) {
      return (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff4d4f' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>⚠️ 文档加载失败</div>
            <div style={{ fontSize: 12, color: '#999' }}>{error}</div>
          </div>
        </div>
      );
    }

    return (
      <div ref={containerRef} style={{ height, position: 'relative', overflow: 'auto', background: '#f7f7f8' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, background: 'rgba(255,255,255,0.8)' }}>
            <Spin tip="加载文档中..." />
          </div>
        )}
        <SuperDocEditorComponent
          ref={superDocRef}
          document={docSource as any}
          documentMode={documentMode}
          role={role}
          user={user}
          modules={stableModules}
          onReady={handleReady}
          onContentError={handleContentError}
          onException={handleException}
          onEditorUpdate={handleUpdate}
          hideToolbar={false}
          style={{ height: '100%', width: '100%' }}
        />
      </div>
    );
  }
);

DocEditor.displayName = 'DocEditor';
export default DocEditor;
