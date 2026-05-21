import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import DOMPurify from 'dompurify';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
} from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { cpp } from '@codemirror/lang-cpp';
import { html } from '@codemirror/lang-html';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { php } from '@codemirror/lang-php';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import type { LucideIcon } from 'lucide-react';
import { Check, Code2, Copy, Eye, FileCode2, RefreshCw, Save, Search } from 'lucide-react';
import { piApi } from '../../api/client';
import type { WorkspaceReadFileResult } from '../../types';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import {
  applyDomSearchHighlights,
  clearDomSearchHighlights,
  getSearchSeedFromDocument,
  normalizeSearchSeed,
  type TextSearchState,
} from '../../lib/textSearch';
import {
  addWorkspaceReferenceToChat,
  textSelectionFromDocument,
  workspaceBasename,
  type TextSelectionReference,
} from '../../lib/selectionReference';
import { SearchReplaceBar } from '../shared/SearchReplaceBar';
import { SelectionReferenceMenu, type SelectionReferenceMenuState } from '../shared/SelectionReferenceMenu';
import { cn } from '../shared/utils';
import { highlightCodeToHtml } from '../markdown/MarkdownRenderer';

interface CodeFileViewerProps {
  sessionId: string;
  filePath: string;
}

type CodeViewMode = 'preview' | 'source';

const CODE_EDITOR_FONT_SCALE_MIN = 0.78;
const CODE_EDITOR_FONT_SCALE_MAX = 1.65;
const CODE_EDITOR_FONT_SCALE_STEP = 0.08;

interface CodeEditorHandle {
  focus: () => void;
  selectedSearchSeed: () => string;
  selectedReference: () => TextSelectionReference | null;
  selectRange: (start: number, end: number) => void;
}

export function CodeFileViewer({ sessionId, filePath }: CodeFileViewerProps) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [file, setFile] = useState<WorkspaceReadFileResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<CodeViewMode>('source');
  const [wrapLines, setWrapLines] = useState(false);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [replaceVisible, setReplaceVisible] = useState(false);
  const [codeEditorFontScale, setCodeEditorFontScale] = useState(1);
  const [searchSeed, setSearchSeed] = useState<{ query: string; version: number }>({ query: '', version: 0 });
  const [searchState, setSearchState] = useState<TextSearchState | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<SelectionReferenceMenuState | null>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    setMode('source');
  }, [filePath]);

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

  const getSelectedSearchSeed = useCallback(() => (
    editorRef.current?.selectedSearchSeed() || getSearchSeedFromDocument()
  ), []);

  const openSearch = useCallback((withReplace: boolean) => {
    const query = getSelectedSearchSeed();
    if (query) {
      setSearchSeed((current) => ({ query, version: current.version + 1 }));
    }
    setSearchVisible(true);
    setReplaceVisible(withReplace);
  }, [getSelectedSearchSeed]);

  const zoomCodeEditorIn = useCallback(() => {
    setCodeEditorFontScale((scale) => clampCodeEditorFontScale(scale + CODE_EDITOR_FONT_SCALE_STEP));
  }, []);

  const zoomCodeEditorOut = useCallback(() => {
    setCodeEditorFontScale((scale) => clampCodeEditorFontScale(scale - CODE_EDITOR_FONT_SCALE_STEP));
  }, []);

  const resetCodeEditorZoom = useCallback(() => {
    setCodeEditorFontScale(1);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveFile();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openSearch(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        openSearch(true);
      } else if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        setWrapLines((value) => !value);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openSearch, saveFile]);

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

  const showSelectionMenu = useCallback((
    event: ReactMouseEvent<HTMLElement>,
    selection: TextSelectionReference | null
  ) => {
    if (!selection) {
      setSelectionMenu(null);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectionMenu({
      ...selection,
      x: event.clientX,
      y: event.clientY,
    });
  }, []);

  const openPreviewSelectionMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    showSelectionMenu(event, textSelectionFromDocument(content, event.currentTarget));
  }, [content, showSelectionMenu]);

  const openSourceSelectionMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    showSelectionMenu(event, editorRef.current?.selectedReference() ?? null);
  }, [showSelectionMenu]);

  const addSelectionToChat = useCallback(() => {
    if (!selectionMenu) return;
    if (!selectionMenu.excerpt.trim()) {
      addToast({ type: 'warning', message: t('rightPanel.selectedTextEmpty') });
      setSelectionMenu(null);
      return;
    }

    addWorkspaceReferenceToChat({
      sessionId,
      path: filePath,
      name: workspaceBasename(filePath),
      lineStart: selectionMenu.lineStart,
      lineEnd: selectionMenu.lineEnd,
      excerpt: selectionMenu.excerpt,
      sourceKind: 'file',
    });
    addToast({ type: 'success', message: t('rightPanel.addedSelectedText') });
    setSelectionMenu(null);
  }, [addToast, filePath, selectionMenu, sessionId, t]);

  useEffect(() => {
    if (!selectionMenu) return;

    const close = () => setSelectionMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    window.addEventListener('click', close);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [selectionMenu]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-pi-bg text-pi-text">
      <div className="pi-reader-toolbar-material flex h-11 flex-shrink-0 items-center gap-2 border-b px-3">
        <FileCode2 size={15} className="flex-shrink-0 text-pi-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-pi-text">{filePath}</div>
          <div className="text-[10px] text-pi-dim">{file?.language || 'text'} · {stats}</div>
        </div>
        <div className="pi-glass-control flex items-center gap-1 rounded-lg p-0.5">
          <ModeButton
            active={mode === 'source'}
            title={t('codeViewer.source')}
            icon={Code2}
            onClick={() => {
              setMode('source');
              window.requestAnimationFrame(() => editorRef.current?.focus());
            }}
          />
          <ModeButton active={mode === 'preview'} title={t('codeViewer.preview')} icon={Eye} onClick={() => setMode('preview')} />
        </div>
        <button
          type="button"
          onClick={() => {
            if (!searchVisible) {
              const query = getSelectedSearchSeed();
              if (query) {
                setSearchSeed((current) => ({ query, version: current.version + 1 }));
              }
            }
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
        visible={searchVisible}
        replaceVisible={replaceVisible}
        initialQuery={searchSeed.version > 0 ? searchSeed.query : undefined}
        initialQueryVersion={searchSeed.version}
        readOnly={!editable}
        onClose={() => {
          setSearchVisible(false);
          setSearchState(null);
        }}
        onReplaceVisibleChange={setReplaceVisible}
        onSearchStateChange={setSearchState}
        onSelectMatch={mode === 'source' ? (start, end) => editorRef.current?.selectRange(start, end) : undefined}
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
        ) : mode === 'preview' ? (
          <CodePreview
            content={content}
            language={file.language || languageFromPath(filePath)}
            lineCount={lines.length}
            wrapLines={wrapLines}
            scrollRef={previewScrollRef}
            searchState={searchState}
            onSelectionContextMenu={openPreviewSelectionMenu}
          />
        ) : (
          <CodeSourceEditor
            value={content}
            wrapLines={wrapLines}
            fontScale={codeEditorFontScale}
            editorRef={editorRef}
            onChange={setContent}
            onToggleWrap={() => setWrapLines((value) => !value)}
            onZoomIn={zoomCodeEditorIn}
            onZoomOut={zoomCodeEditorOut}
            onZoomReset={resetCodeEditorZoom}
            onSelectionContextMenu={openSourceSelectionMenu}
            language={file.language || languageFromPath(filePath)}
          />
        )}
      </div>

      <div className="flex h-7 flex-shrink-0 items-center gap-2 border-t border-pi-border px-3 text-[10px] text-pi-dim">
        <span>{file?.language || 'text'}</span>
        <span className="h-3 w-px bg-pi-border" />
        <span>{stats}</span>
        {mode === 'source' && codeEditorFontScale !== 1 && (
          <>
            <span className="h-3 w-px bg-pi-border" />
            <span>{Math.round(codeEditorFontScale * 100)}%</span>
          </>
        )}
        {file?.truncated && <span className="ml-auto text-pi-warning">{t('permission.previewTruncated')}</span>}
      </div>

      {selectionMenu && (
        <SelectionReferenceMenu state={selectionMenu} onAdd={addSelectionToChat} />
      )}
    </div>
  );
}

function CodePreview({
  content,
  language,
  lineCount,
  wrapLines,
  scrollRef,
  searchState,
  onSelectionContextMenu,
}: {
  content: string;
  language: string;
  lineCount: number;
  wrapLines: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
  searchState?: TextSearchState | null;
  onSelectionContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const [html, setHtml] = useState('');

  const applyPreviewSearch = useCallback(() => {
    const root = localRef.current;
    if (!root) return;
    if (!searchState?.query) {
      clearDomSearchHighlights(root);
      return;
    }
    applyDomSearchHighlights(root, searchState.query, searchState.options, searchState.currentIndex);
  }, [searchState]);

  useEffect(() => {
    let cancelled = false;
    setHtml('');

    highlightCodeToHtml(content, language)
      .then((nextHtml) => {
        if (cancelled) return;
        setHtml(DOMPurify.sanitize(nextHtml, {
          USE_PROFILES: { html: true },
          ADD_ATTR: ['class', 'style'],
        }));
      })
      .catch(() => {
        if (cancelled) return;
        setHtml(`<pre><code>${escapeHtml(content)}</code></pre>`);
      });

    return () => {
      cancelled = true;
    };
  }, [content, language]);

  useEffect(() => {
    applyPreviewSearch();
    const root = localRef.current;
    if (!root) return;
    return () => clearDomSearchHighlights(root);
  }, [applyPreviewSearch, html]);

  return (
    <div
      ref={(node) => {
        localRef.current = node;
        if (scrollRef) {
          (scrollRef as { current: HTMLDivElement | null }).current = node;
        }
      }}
      onContextMenu={onSelectionContextMenu}
      className="pi-selectable code-viewer-preview h-full min-h-0 overflow-auto overscroll-contain bg-pi-bg text-pi-tool-output"
    >
      <div className={cn(
        'grid min-h-full grid-cols-[auto_minmax(0,1fr)] font-mono text-[1rem] leading-[1.45]',
        wrapLines ? 'pi-code-wrap' : 'min-w-max'
      )}>
        <div className="select-none border-r border-pi-border bg-pi-bg-secondary/45 py-4 pl-3 pr-4 text-right text-pi-dim">
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index} style={{ minWidth: `${Math.max(3, String(lineCount).length)}ch` }}>
              {index + 1}
            </div>
          ))}
        </div>
        <div
          className="code-viewer-highlight min-w-0 px-5"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

function CodeSourceEditor({
  value,
  wrapLines,
  fontScale,
  editorRef,
  language,
  onChange,
  onToggleWrap,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onSelectionContextMenu,
}: {
  value: string;
  wrapLines: boolean;
  fontScale: number;
  editorRef: RefObject<CodeEditorHandle | null>;
  language: string;
  onChange: (value: string) => void;
  onToggleWrap: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onSelectionContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onToggleWrapRef = useRef(onToggleWrap);
  const onZoomInRef = useRef(onZoomIn);
  const onZoomOutRef = useRef(onZoomOut);
  const onZoomResetRef = useRef(onZoomReset);
  const languageCompartmentRef = useRef(new Compartment());
  const wrapCompartmentRef = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onToggleWrapRef.current = onToggleWrap;
  }, [onToggleWrap]);

  useEffect(() => {
    onZoomInRef.current = onZoomIn;
    onZoomOutRef.current = onZoomOut;
    onZoomResetRef.current = onZoomReset;
  }, [onZoomIn, onZoomOut, onZoomReset]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          foldGutter({ openText: '⌄', closedText: '›' }),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          syntaxHighlighting(codeEditorHighlightStyle),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          codeEditorTheme,
          languageCompartmentRef.current.of(languageExtensionFor(language)),
          wrapCompartmentRef.current.of(wrapLines ? EditorView.lineWrapping : []),
          keymap.of([
            indentWithTab,
            { key: 'Mod-/', run: toggleComment },
            { key: 'Alt-z', run: () => { onToggleWrapRef.current(); return true; } },
            { key: 'Mod-=', run: () => { onZoomInRef.current(); return true; } },
            { key: 'Mod-+', run: () => { onZoomInRef.current(); return true; } },
            { key: 'Mod--', run: () => { onZoomOutRef.current(); return true; } },
            { key: 'Mod-0', run: () => { onZoomResetRef.current(); return true; } },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });

    viewRef.current = view;
    (editorRef as { current: CodeEditorHandle | null }).current = {
      focus: () => view.focus(),
      selectedSearchSeed: () => normalizeSearchSeed(selectedTextFromView(view)),
      selectedReference: () => selectionReferenceFromView(view),
      selectRange: (start, end) => {
        const safeStart = clampOffset(start, view.state.doc.length);
        const safeEnd = clampOffset(end, view.state.doc.length);
        view.dispatch({
          selection: { anchor: safeStart, head: safeEnd },
          scrollIntoView: true,
        });
      },
    };

    return () => {
      if (viewRef.current === view) viewRef.current = null;
      if ((editorRef as { current: CodeEditorHandle | null }).current) {
        (editorRef as { current: CodeEditorHandle | null }).current = null;
      }
      view.destroy();
    };
  }, [editorRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentValue = view.state.doc.toString();
    if (currentValue === value) return;
    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartmentRef.current.reconfigure(languageExtensionFor(language)),
    });
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartmentRef.current.reconfigure(wrapLines ? EditorView.lineWrapping : []),
    });
  }, [wrapLines]);

  useEffect(() => {
    viewRef.current?.requestMeasure();
  }, [fontScale]);

  return (
    <div
      ref={hostRef}
      onContextMenu={onSelectionContextMenu}
      className="code-viewer-source h-full min-h-0 bg-pi-bg"
      style={{ '--pi-code-editor-font-size': `${fontScale}rem` } as CSSProperties}
    />
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

const codeEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--pi-bg)',
    color: 'var(--pi-tool-output)',
    fontFamily: 'var(--font-code-editor)',
    fontSize: 'var(--pi-code-editor-font-size, 1rem)',
  },
  '.cm-editor': {
    height: '100%',
  },
  '.cm-scroller': {
    height: '100%',
    overflow: 'auto',
    fontFamily: 'var(--font-code-editor)',
    lineHeight: '1.45',
  },
  '.cm-content': {
    minHeight: '100%',
    padding: '12px 0 16px',
    caretColor: 'var(--pi-accent)',
  },
  '.cm-line': {
    padding: '0 20px',
  },
  '.cm-gutters': {
    backgroundColor: 'color-mix(in srgb, var(--pi-bg-secondary) 48%, transparent)',
    color: 'color-mix(in srgb, var(--pi-dim) 82%, transparent)',
    borderRight: '1px solid var(--pi-border)',
  },
  '.cm-gutterElement': {
    padding: '0 12px 0 10px',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--pi-accent) 7%, transparent)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--pi-accent) 10%, transparent)',
    color: 'var(--pi-muted)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(38, 79, 120, 0.72) !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--pi-accent)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--pi-accent) 18%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--pi-accent) 45%, transparent)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--pi-warning) 30%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--pi-warning) 36%, transparent)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--pi-accent) 40%, transparent)',
  },
  '.cm-foldGutter span': {
    color: 'var(--pi-dim)',
  },
}, { dark: true });

const codeEditorHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--pi-syntax-keyword)', fontWeight: '600' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.function(tags.variableName))], color: 'var(--pi-syntax-function)', fontWeight: '600' },
  { tag: [tags.variableName, tags.propertyName], color: 'var(--pi-syntax-variable)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--pi-syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--pi-syntax-number)' },
  { tag: [tags.typeName, tags.className], color: 'var(--pi-syntax-type)' },
  { tag: [tags.operator, tags.compareOperator, tags.logicOperator], color: 'var(--pi-syntax-operator)' },
  { tag: tags.comment, color: 'var(--pi-syntax-comment)', fontStyle: 'italic' },
  { tag: tags.punctuation, color: 'var(--pi-syntax-punctuation)' },
  { tag: tags.bracket, color: 'var(--pi-text)' },
  { tag: tags.invalid, color: 'var(--pi-error)' },
]);

function languageExtensionFor(language: string): Extension {
  switch (language.toLowerCase()) {
    case 'typescript':
    case 'ts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ typescript: true, jsx: true });
    case 'javascript':
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'json':
    case 'jsonc':
      return json();
    case 'html':
      return html();
    case 'css':
      return css();
    case 'markdown':
    case 'md':
    case 'mdx':
      return markdown();
    case 'python':
    case 'py':
      return python();
    case 'sql':
      return sql();
    case 'xml':
      return xml();
    case 'yaml':
    case 'yml':
      return yaml();
    case 'java':
      return java();
    case 'c':
    case 'cpp':
    case 'c++':
    case 'hpp':
    case 'h':
      return cpp();
    case 'php':
      return php();
    case 'rust':
    case 'rs':
      return rust();
    case 'lua':
      return StreamLanguage.define(lua);
    default:
      return [];
  }
}

function clampCodeEditorFontScale(value: number): number {
  const next = Math.min(Math.max(value, CODE_EDITOR_FONT_SCALE_MIN), CODE_EDITOR_FONT_SCALE_MAX);
  return Math.round(next * 100) / 100;
}

function selectedTextFromView(view: EditorView): string {
  const range = view.state.selection.main;
  if (range.empty) return '';
  return view.state.doc.sliceString(Math.min(range.from, range.to), Math.max(range.from, range.to));
}

function selectionReferenceFromView(view: EditorView): TextSelectionReference | null {
  const range = view.state.selection.main;
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  if (from === to) return null;

  const excerpt = view.state.doc.sliceString(from, to).replace(/\r\n?/g, '\n').trim();
  if (!excerpt) return null;

  return {
    excerpt,
    lineStart: view.state.doc.lineAt(from).number,
    lineEnd: view.state.doc.lineAt(Math.max(from, to - 1)).number,
  };
}

function clampOffset(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function ModeButton({
  active,
  title,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  title: string;
  icon: LucideIcon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
        active ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      <Icon size={12} />
    </button>
  );
}

function languageFromPath(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile') return 'docker';
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : '';
  const map: Record<string, string> = {
    cjs: 'javascript',
    css: 'css',
    dart: 'dart',
    go: 'go',
    h: 'c',
    hpp: 'c',
    html: 'html',
    ini: 'ini',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsonc: 'jsonc',
    jsx: 'jsx',
    kt: 'kotlin',
    lua: 'lua',
    md: 'markdown',
    mdx: 'markdown',
    mjs: 'javascript',
    php: 'php',
    ps1: 'shellscript',
    py: 'python',
    r: 'r',
    rb: 'ruby',
    rs: 'rust',
    scala: 'scala',
    sh: 'bash',
    sql: 'sql',
    svelte: 'svelte',
    swift: 'swift',
    toml: 'toml',
    ts: 'typescript',
    tsx: 'tsx',
    vue: 'vue',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return map[ext] ?? 'text';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
