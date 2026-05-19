import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Code2, Copy, FileCode2, RefreshCw, Save, Search } from 'lucide-react';
import { piApi } from '../../api/client';
import type { WorkspaceReadFileResult } from '../../types';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import { SearchReplaceBar } from '../shared/SearchReplaceBar';
import { cn } from '../shared/utils';

interface CodeFileViewerProps {
  sessionId: string;
  filePath: string;
}

export function CodeFileViewer({ sessionId, filePath }: CodeFileViewerProps) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [file, setFile] = useState<WorkspaceReadFileResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [replaceVisible, setReplaceVisible] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const loadFile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextFile = await piApi.getWorkspaceFile(sessionId, filePath);
      setFile(nextFile);
      if (nextFile.state === 'ok' && nextFile.previewType !== 'image') {
        const nextContent = nextFile.content ?? '';
        setContent(nextContent);
        setSavedContent(nextContent);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filePath, sessionId]);

  useEffect(() => {
    void loadFile();
  }, [loadFile]);

  const lines = useMemo(() => content.split('\n'), [content]);
  const stats = useMemo(() => t('codeViewer.stats', { lines: lines.length, size: formatBytes(file?.size ?? 0) }), [file?.size, lines.length, t]);
  const editable = Boolean(file?.state === 'ok' && file.previewType !== 'image');
  const dirty = editable && content !== savedContent;

  const saveFile = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await piApi.writeWorkspaceFile(sessionId, filePath, content);
      if (result.state !== 'ok') {
        throw new Error(result.error ?? t('codeViewer.saveFailed'));
      }
      setSavedContent(content);
      setFile((current) => current && current.state === 'ok'
        ? { ...current, content, size: result.size, truncated: false }
        : current);
      window.dispatchEvent(new CustomEvent('pi:workspace-changed', { detail: { sessionId } }));
      addToast({ type: 'success', message: t('codeViewer.savedToast') });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      addToast({ type: 'error', message, duration: 6000 });
    } finally {
      setSaving(false);
    }
  }, [addToast, content, dirty, filePath, saving, sessionId, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveFile();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchVisible(true);
        setReplaceVisible(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setSearchVisible(true);
        setReplaceVisible(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveFile]);

  const copyFile = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      addToast({ type: 'success', message: t('codeViewer.fileCopied') });
    } catch {
      addToast({ type: 'error', message: t('codeViewer.copyFailed') });
    }
  };

  const syncLineNumberScroll = () => {
    if (lineNumbersRef.current && editorRef.current) {
      lineNumbersRef.current.scrollTop = editorRef.current.scrollTop;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-pi-bg text-pi-text">
      <div className="pi-reader-toolbar-material flex h-11 flex-shrink-0 items-center gap-2 border-b px-3">
        <FileCode2 size={15} className="flex-shrink-0 text-pi-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-pi-text">{filePath}</div>
          <div className="text-[10px] text-pi-dim">{file?.language || 'text'} · {stats}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setSearchVisible((visible) => !visible);
            setReplaceVisible(false);
          }}
          disabled={!editable}
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-45',
            searchVisible ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
          )}
          title={t('search.find')}
        >
          <Search size={13} />
        </button>
        <button
          type="button"
          onClick={() => setWrapLines((value) => !value)}
          className={cn(
            'flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors',
            wrapLines ? 'bg-pi-accent/10 text-pi-accent' : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
          )}
          title={t('codeViewer.toggleWrap')}
        >
          <Code2 size={12} />
          <span>{t('codeViewer.wrap')}</span>
        </button>
        <button
          type="button"
          onClick={() => void saveFile()}
          disabled={!dirty || saving}
          className={cn(
            'flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-45',
            dirty ? 'bg-pi-accent text-white hover:bg-pi-accent/90' : 'text-pi-success hover:bg-pi-success/10'
          )}
          title={t('codeViewer.saveFile')}
        >
          {dirty ? <Save size={12} /> : <Check size={12} />}
          <span>{saving ? t('markdown.saving') : dirty ? t('common.save') : t('markdown.saved')}</span>
        </button>
        <button
          type="button"
          onClick={() => void copyFile()}
          disabled={!content}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-45"
          title={t('codeViewer.copyFile')}
        >
          {copied ? <Check size={12} className="text-pi-success" /> : <Copy size={12} />}
          <span>{copied ? t('common.copied') : t('common.copy')}</span>
        </button>
        <button
          type="button"
          onClick={() => void loadFile()}
          disabled={loading || saving}
          className="flex h-7 w-7 items-center justify-center rounded-md text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-wait disabled:opacity-50"
          title={t('codeViewer.reload')}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="flex-shrink-0 border-b border-pi-error/30 bg-pi-error/10 px-3 py-2 text-xs text-pi-error">
          {error}
        </div>
      )}

      <SearchReplaceBar
        text={content}
        onTextChange={setContent}
        textInputRef={editorRef}
        visible={searchVisible}
        replaceVisible={replaceVisible}
        readOnly={!editable}
        onClose={() => setSearchVisible(false)}
        onReplaceVisibleChange={setReplaceVisible}
      />

      <div className="min-h-0 flex-1 overflow-hidden bg-pi-bg">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-pi-dim">
            <RefreshCw size={14} className="animate-spin" />
            {t('codeViewer.loading')}
          </div>
        ) : !file ? (
          <EmptyCodeState message={t('codeViewer.fileUnavailable')} />
        ) : file.state === 'missing' ? (
          <EmptyCodeState message={t('rightPanel.fileMissing')} tone="error" />
        ) : file.state === 'binary' ? (
          <EmptyCodeState message={t('rightPanel.binaryPreviewUnavailable')} />
        ) : file.state === 'too_large' ? (
          <EmptyCodeState message={t('rightPanel.fileTooLarge', { size: formatBytes(file.size) })} />
        ) : file.state === 'error' ? (
          <EmptyCodeState message={file.error ?? t('rightPanel.unableLoadFile')} tone="error" />
        ) : file.previewType === 'image' && file.dataUrl ? (
          <div className="flex h-full items-start justify-center overflow-auto p-5">
            <img src={file.dataUrl} alt={file.path} className="max-w-full rounded-md border border-pi-border bg-pi-bg-tertiary" />
          </div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-[auto_minmax(0,1fr)] bg-pi-bg font-mono text-[12px] leading-relaxed">
            <div
              ref={lineNumbersRef}
              className="min-h-0 overflow-hidden border-r border-pi-border bg-pi-bg-secondary/45 py-3 pl-2 pr-3 text-right text-pi-dim"
              aria-hidden="true"
            >
              {lines.map((_, index) => (
                <div key={index} className="select-none" style={{ minWidth: `${Math.max(3, String(lines.length).length)}ch` }}>
                  {index + 1}
                </div>
              ))}
            </div>
            <textarea
              ref={editorRef}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onScroll={syncLineNumberScroll}
              spellCheck={false}
              wrap={wrapLines ? 'soft' : 'off'}
              className={cn(
                'block h-full min-h-0 w-full resize-none overflow-auto overscroll-contain bg-pi-bg px-3 py-3 font-mono text-[12px] leading-relaxed text-pi-tool-output outline-none selection:bg-pi-selected-bg',
                wrapLines ? 'whitespace-pre-wrap' : 'whitespace-pre'
              )}
            />
          </div>
        )}
      </div>

      <div className="flex h-7 flex-shrink-0 items-center gap-2 border-t border-pi-border px-3 text-[10px] text-pi-dim">
        <span>{file?.language || 'text'}</span>
        <span className="h-3 w-px bg-pi-border" />
        <span>{stats}</span>
        {file?.truncated && <span className="ml-auto text-pi-warning">{t('permission.previewTruncated')}</span>}
      </div>
    </div>
  );
}

function EmptyCodeState({ message, tone = 'muted' }: { message: string; tone?: 'muted' | 'error' }) {
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-2 px-5 text-center', tone === 'error' ? 'text-pi-error' : 'text-pi-dim')}>
      <FileCode2 size={28} strokeWidth={1.4} />
      <p className="text-xs leading-relaxed">{message}</p>
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
