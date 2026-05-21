import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, File, Folder, Loader2, MessageSquarePlus, Search, X } from 'lucide-react';
import { piApi } from '../../api/client';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import type { WorkspaceTreeEntry } from '../../types';
import { cn } from '../shared/utils';

const WORKSPACE_REFERENCE_EVENT = 'pi:add-workspace-reference';

interface WorkspaceQuickOpenProps {
  sessionId: string;
  onClose: () => void;
}

export function WorkspaceQuickOpen({ sessionId, onClose }: WorkspaceQuickOpenProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkspaceTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestWorkspaceOpen = useUIStore((s) => s.requestWorkspaceOpen);
  const addToast = useUIStore((s) => s.addToast);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === sessionId));

  const selectedFile = results[selectedIndex] ?? null;
  const projectLabel = activeSession?.projectName ?? t('workspaceQuickOpen.workspace');

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(() => {
      piApi.searchWorkspaceFiles(sessionId, query)
        .then((result) => {
          if (requestId !== requestRef.current) return;
          if (result.state === 'ok') {
            setResults(result.files);
          } else {
            setResults([]);
            setError(result.error ?? t('workspaceQuickOpen.searchFailed'));
          }
        })
        .catch((err) => {
          if (requestId !== requestRef.current) return;
          setResults([]);
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (requestId === requestRef.current) {
            setLoading(false);
          }
        });
    }, 90);

    return () => window.clearTimeout(timer);
  }, [query, sessionId, t]);

  const openFile = (file: WorkspaceTreeEntry | null) => {
    if (!file) return;
    requestWorkspaceOpen(sessionId, file.path);
    onClose();
  };

  const addFileReference = (file: WorkspaceTreeEntry | null) => {
    if (!file) return;
    window.dispatchEvent(new CustomEvent(WORKSPACE_REFERENCE_EVENT, {
      detail: {
        sessionId,
        path: file.path,
        name: file.name,
      },
    }));
    addToast({ type: 'success', message: t('workspaceQuickOpen.addedReference', { path: file.path }) });
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(Math.max(0, results.length - 1), current + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(0, current - 1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setSelectedIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setSelectedIndex(Math.max(0, results.length - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        addFileReference(selectedFile);
      } else {
        openFile(selectedFile);
      }
    }
  };

  const statusText = useMemo(() => {
    if (loading) return t('workspaceQuickOpen.searching');
    if (error) return error;
    if (results.length === 0) return t('workspaceQuickOpen.noResults');
    return t('workspaceQuickOpen.resultCount', { count: results.length });
  }, [error, loading, results.length, t]);

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/35 px-4 pt-[12vh] backdrop-blur-sm">
      <button
        aria-label={t('common.close')}
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={onClose}
      />

      <div className="pi-panel-material relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-pi-border shadow-2xl shadow-black/35">
        <div className="flex items-center gap-3 border-b border-pi-border/70 px-3 py-2.5">
          <Search size={16} className="flex-shrink-0 text-pi-accent" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('workspaceQuickOpen.placeholder')}
            className="pi-embedded-input h-8 min-w-0 flex-1 bg-transparent text-sm text-pi-text outline-none placeholder:text-pi-dim"
          />
          {loading && <Loader2 size={15} className="animate-spin text-pi-dim" />}
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="flex h-7 w-7 items-center justify-center rounded-md text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
              title={t('workspaceQuickOpen.clear')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 border-b border-pi-border/50 px-3 py-2 text-[11px] text-pi-dim">
          <Folder size={12} className="flex-shrink-0" />
          <span className="min-w-0 flex-1 truncate">{projectLabel}</span>
          <span className={cn('flex-shrink-0', error && 'text-pi-error')}>{statusText}</span>
        </div>

        <div className="max-h-[420px] min-h-[180px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center text-xs text-pi-dim">
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              <span>{statusText}</span>
            </div>
          ) : (
            results.map((file, index) => (
              <button
                key={file.path}
                type="button"
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => openFile(file)}
                className={cn(
                  'group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                  index === selectedIndex ? 'bg-pi-selected-bg text-pi-text' : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
                )}
              >
                <File size={14} className="flex-shrink-0 text-pi-dim group-hover:text-pi-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{file.name}</div>
                  <div className="truncate font-mono text-[10px] text-pi-dim">{file.path}</div>
                </div>
                {index === selectedIndex && (
                  <div className="hidden flex-shrink-0 items-center gap-1 text-[10px] text-pi-dim sm:flex">
                    <CornerDownLeft size={12} />
                    <span>{t('workspaceQuickOpen.open')}</span>
                  </div>
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-pi-border/60 px-3 py-2 text-[10px] text-pi-dim">
          <span>{t('workspaceQuickOpen.shortcut')}</span>
          <button
            type="button"
            disabled={!selectedFile}
            onClick={() => addFileReference(selectedFile)}
            className="flex h-7 items-center gap-1.5 rounded-md border border-pi-border bg-pi-bg-secondary px-2 text-[11px] text-pi-muted transition-colors hover:border-pi-accent/50 hover:bg-pi-accent/10 hover:text-pi-accent disabled:cursor-not-allowed disabled:opacity-50"
            title={t('workspaceQuickOpen.addToChat')}
          >
            <MessageSquarePlus size={13} />
            <span>{t('workspaceQuickOpen.addToChat')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
