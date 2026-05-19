import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  ChatMessage,
  ImageAttachment,
  ModelInfo,
  PermissionMode,
  Session,
  SlashCommandInfo,
  ThinkingLevel,
  WorkspaceReadFileResult,
  WorkspaceTreeEntry,
} from '../../types';
import { piApi } from '../../api/client';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { useModelStore } from '../../stores/modelStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../shared/utils';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import {
  AtSign,
  Bot,
  Brain,
  Command,
  FileText,
  Gauge,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Search,
  Send,
  Shield,
  Square,
  X,
} from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string, images?: Array<{ data: string; mimeType: string }>, displayText?: string) => boolean | void;
  onStop: () => void;
  isStreaming: boolean;
  sessionId: string;
}

interface WorkspaceFileReference {
  id: string;
  path: string;
  name: string;
  lineStart?: number;
  lineEnd?: number;
  excerpt?: string;
  sourceKind?: 'file' | 'diff';
}

interface ComposerDraft {
  text: string;
  attachments: ImageAttachment[];
  fileReferences: WorkspaceFileReference[];
}

type WorkspaceReferenceEventDetail = {
  sessionId?: string;
  path?: string;
  name?: string;
  lineStart?: number;
  lineEnd?: number;
  excerpt?: string;
  sourceKind?: 'file' | 'diff';
};

const WORKSPACE_REFERENCE_EVENT = 'pi:add-workspace-reference';
const MAX_REFERENCE_CHARS = 24000;
const MAX_TEXT_ATTACHMENT_BYTES = 512 * 1024;
const EMPTY_MESSAGES: ChatMessage[] = [];
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'cs',
  'css',
  'csv',
  'go',
  'h',
  'hpp',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'log',
  'lua',
  'md',
  'mdx',
  'php',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'swift',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

const FALLBACK_SLASH_COMMANDS: Array<{
  name: string;
  descriptionKey: TranslationKey;
  categoryKey: TranslationKey;
  source: SlashCommandInfo['source'];
}> = [
  { name: '/commit', descriptionKey: 'chat.slash.commit', categoryKey: 'chat.category.git', source: 'builtin' },
  { name: '/review', descriptionKey: 'chat.slash.review', categoryKey: 'chat.category.code', source: 'builtin' },
  { name: '/debug', descriptionKey: 'chat.slash.debug', categoryKey: 'chat.category.code', source: 'builtin' },
  { name: '/compact', descriptionKey: 'chat.slash.compact', categoryKey: 'chat.category.session', source: 'builtin' },
  { name: '/tree', descriptionKey: 'chat.slash.tree', categoryKey: 'chat.category.session', source: 'builtin' },
];

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const PERMISSION_MODE_OPTIONS: PermissionMode[] = ['ask', 'acceptEdits', 'plan', 'bypassPermissions'];

export function ChatInput({ onSend, onStop, isStreaming, sessionId }: ChatInputProps) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [fileReferences, setFileReferences] = useState<WorkspaceFileReference[]>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [showFileSearch, setShowFileSearch] = useState(false);
  const [fileSearchFilter, setFileSearchFilter] = useState('');
  const [fileSearchResults, setFileSearchResults] = useState<WorkspaceTreeEntry[]>([]);
  const [fileSearchLoading, setFileSearchLoading] = useState(false);
  const [fileSearchError, setFileSearchError] = useState<string | null>(null);
  const [fileSelectedIndex, setFileSelectedIndex] = useState(0);
  const [atTokenStart, setAtTokenStart] = useState(-1);
  const [isPreparingPrompt, setIsPreparingPrompt] = useState(false);
  const [openControlMenu, setOpenControlMenu] = useState<'model' | 'permission' | 'thinking' | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlBarRef = useRef<HTMLDivElement>(null);
  const searchRequestRef = useRef(0);
  const composingRef = useRef(false);
  const draftsRef = useRef<Record<string, ComposerDraft>>({});
  const currentSessionRef = useRef(sessionId);
  const textRef = useRef(text);
  const attachmentsRef = useRef(attachments);
  const fileReferencesRef = useRef(fileReferences);
  const addToast = useUIStore((s) => s.addToast);
  const setRightPanel = useUIStore((s) => s.setRightPanel);
  const runtimeSlashCommands = useUIStore((s) => s.slashCommands);
  const messages = useChatStore((s) => s.messagesBySession[sessionId] ?? EMPTY_MESSAGES);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === sessionId));
  const globalCurrentModel = useModelStore((s) => s.currentModel);
  const availableModels = useModelStore((s) => s.availableModels);
  const globalThinkingLevel = useModelStore((s) => s.thinkingLevel);
  const permissionMode = useSettingsStore((s) => s.permissionMode);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const currentModel = useMemo(
    () => modelForSession(activeSession, availableModels, globalCurrentModel),
    [activeSession, availableModels, globalCurrentModel]
  );
  const thinkingLevel = activeSession?.thinkingLevel ?? globalThinkingLevel;

  const fallbackSlashCommands = useMemo(() => localizeFallbackSlashCommands(t), [t]);
  const slashCommands = useMemo(
    () => mergeSlashCommands(
      runtimeSlashCommands.length > 0 ? runtimeSlashCommands : fallbackSlashCommands,
      fallbackSlashCommands
    ),
    [fallbackSlashCommands, runtimeSlashCommands]
  );

  const filteredCommands = useMemo(
    () => slashCommands.filter((command) => {
      const filter = slashFilter.toLowerCase();
      return command.name.toLowerCase().includes(filter) || command.description.toLowerCase().includes(filter);
    }),
    [slashCommands, slashFilter]
  );

  const selectableFileResults = useMemo(
    () => fileSearchResults.filter((entry) => !fileReferences.some((ref) => ref.path === entry.path)),
    [fileReferences, fileSearchResults]
  );

  const canSubmit = text.trim().length > 0 || attachments.length > 0 || fileReferences.length > 0;
  const contextUsage = useMemo(
    () => estimateComposerContext(messages, text, fileReferences, attachments, currentModel, t),
    [attachments, currentModel, fileReferences, messages, text, t]
  );

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    fileReferencesRef.current = fileReferences;
  }, [fileReferences]);

  useEffect(() => {
    const previousSessionId = currentSessionRef.current;
    if (previousSessionId !== sessionId) {
      draftsRef.current[previousSessionId] = {
        text: textRef.current,
        attachments: attachmentsRef.current,
        fileReferences: fileReferencesRef.current,
      };

      const draft = draftsRef.current[sessionId];
      setText(draft?.text ?? '');
      setAttachments(draft?.attachments ?? []);
      setFileReferences(draft?.fileReferences ?? []);
      currentSessionRef.current = sessionId;
    }

    textareaRef.current?.focus();
    closeFileSearch();
    setShowSlashMenu(false);
  }, [sessionId]);

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashFilter]);

  useEffect(() => {
    setFileSelectedIndex(0);
  }, [fileSearchFilter, showFileSearch]);

  useEffect(() => {
    if (fileSelectedIndex >= selectableFileResults.length) {
      setFileSelectedIndex(Math.max(0, selectableFileResults.length - 1));
    }
  }, [fileSelectedIndex, selectableFileResults.length]);

  useEffect(() => {
    if (!openControlMenu) return;

    const close = (event: globalThis.MouseEvent) => {
      if (controlBarRef.current?.contains(event.target as Node)) return;
      setOpenControlMenu(null);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpenControlMenu(null);
    };

    window.addEventListener('click', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [openControlMenu]);

  const addFileReference = useCallback((path: string, options?: {
    name?: string;
    lineStart?: number;
    lineEnd?: number;
    excerpt?: string;
    sourceKind?: 'file' | 'diff';
  }) => {
    const normalizedPath = normalizeWorkspacePath(path);
    if (!normalizedPath) return;
    const normalizedLineStart = normalizeLineNumber(options?.lineStart);
    const normalizedLineEnd = normalizeLineNumber(options?.lineEnd) ?? normalizedLineStart;

    setFileReferences((prev) => {
      if (prev.some((ref) =>
        ref.path === normalizedPath &&
        (ref.lineStart ?? 0) === (normalizedLineStart ?? 0) &&
        (ref.lineEnd ?? 0) === (normalizedLineEnd ?? 0) &&
        (ref.sourceKind ?? 'file') === (options?.sourceKind ?? 'file')
      )) {
        return prev;
      }
      return [
        ...prev,
        {
          id: `file-ref-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          path: normalizedPath,
          name: options?.name || basename(normalizedPath),
          lineStart: normalizedLineStart,
          lineEnd: normalizedLineEnd,
          excerpt: options?.excerpt,
          sourceKind: options?.sourceKind,
        },
      ];
    });
  }, []);

  useEffect(() => {
    const handleWorkspaceReference = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceReferenceEventDetail>).detail;
      if (!detail?.path) return;
      if (detail.sessionId && detail.sessionId !== sessionId) return;
      addFileReference(detail.path, {
        name: detail.name,
        lineStart: detail.lineStart,
        lineEnd: detail.lineEnd,
        excerpt: detail.excerpt,
        sourceKind: detail.sourceKind,
      });
      textareaRef.current?.focus();
    };

    window.addEventListener(WORKSPACE_REFERENCE_EVENT, handleWorkspaceReference);
    return () => window.removeEventListener(WORKSPACE_REFERENCE_EVENT, handleWorkspaceReference);
  }, [addFileReference, sessionId]);

  useEffect(() => {
    if (!showFileSearch) return;

    const requestId = ++searchRequestRef.current;
    setFileSearchLoading(true);
    setFileSearchError(null);

    const timer = window.setTimeout(() => {
      piApi.searchWorkspaceFiles(sessionId, fileSearchFilter)
        .then((result) => {
          if (requestId !== searchRequestRef.current) return;
          if (result.state === 'ok') {
            setFileSearchResults(result.files);
          } else {
            setFileSearchResults([]);
            setFileSearchError(result.error ?? t('chat.searchWorkspaceFailed'));
          }
        })
        .catch((err) => {
          if (requestId !== searchRequestRef.current) return;
          setFileSearchResults([]);
          setFileSearchError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (requestId === searchRequestRef.current) {
            setFileSearchLoading(false);
          }
        });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [fileSearchFilter, sessionId, showFileSearch, t]);

  const detectSlashTrigger = useCallback((value: string, cursorPos: number) => {
    const beforeCursor = value.slice(0, cursorPos);
    const slashMatch = beforeCursor.match(/^\/(\w*)$/);
    if (!slashMatch) {
      setShowSlashMenu(false);
      return false;
    }

    setSlashFilter(slashMatch[1] ?? '');
    setShowSlashMenu(true);
    setShowFileSearch(false);
    return true;
  }, []);

  const detectAtTrigger = useCallback((value: string, cursorPos: number) => {
    const beforeCursor = value.slice(0, cursorPos);
    let tokenStart = -1;

    for (let index = beforeCursor.length - 1; index >= 0; index--) {
      const ch = beforeCursor[index]!;
      if (ch === '@') {
        if (index === 0 || /\s/.test(beforeCursor[index - 1]!)) {
          tokenStart = index;
        }
        break;
      }
      if (/\s/.test(ch)) break;
    }

    if (tokenStart < 0) {
      closeFileSearch();
      return false;
    }

    setAtTokenStart(tokenStart);
    setFileSearchFilter(beforeCursor.slice(tokenStart + 1));
    setShowFileSearch(true);
    setShowSlashMenu(false);
    return true;
  }, []);

  const handleTextChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const cursorPos = event.target.selectionStart ?? value.length;
    setText(value);
    if (!detectSlashTrigger(value, cursorPos)) {
      detectAtTrigger(value, cursorPos);
    }
  };

  const handleSend = async () => {
    if (isPreparingPrompt || !canSubmit) return;

    const trimmed = text.trim();
    const references = fileReferences;
    const images = attachments.length > 0
      ? attachments.map((attachment) => ({ data: attachment.data, mimeType: attachment.mimeType }))
      : undefined;

    setIsPreparingPrompt(true);
    try {
      const modelText = references.length > 0
        ? await buildPromptWithReferences(sessionId, references, trimmed)
        : trimmed;
      const displayText = buildDisplayText(trimmed, references);

      const sent = onSend(modelText, images, displayText);
      if (sent === false) return;

      setText('');
      setAttachments([]);
      setFileReferences([]);
      draftsRef.current[sessionId] = { text: '', attachments: [], fileReferences: [] };
      closeFileSearch();
      setShowSlashMenu(false);
      textareaRef.current?.focus();
    } catch (err) {
      addToast({
        type: 'error',
        message: t('chat.sendFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    } finally {
      setIsPreparingPrompt(false);
    }
  };

  const selectSlashCommand = (command: SlashCommandInfo) => {
    const insertText = command.insertText ?? `${command.name} `;
    setText(insertText);
    setShowSlashMenu(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertText.length, insertText.length);
    });
  };

  const selectModel = (model: ModelInfo) => {
    const sent = piApi.send({ type: 'set_model', sessionId, provider: model.provider, modelId: model.id });
    if (!sent) {
      addToast({ type: 'error', message: t('chat.switchModelDisconnected') });
    }
    setOpenControlMenu(null);
  };

  const selectThinkingLevel = (level: ThinkingLevel) => {
    const sent = piApi.send({ type: 'set_thinking_level', sessionId, level });
    if (!sent) {
      addToast({ type: 'error', message: t('chat.switchThinkingDisconnected') });
    }
    setOpenControlMenu(null);
  };

  const selectPermissionMode = (mode: PermissionMode) => {
    updateSetting('permissionMode', mode);
    const sent = piApi.send({ type: 'set_permission_mode', mode });
    if (!sent) {
      addToast({ type: 'error', message: t('chat.syncPermissionDisconnected') });
    }
    setOpenControlMenu(null);
  };

  const selectFileResult = (entry: WorkspaceTreeEntry) => {
    addFileReference(entry.path, { name: entry.name });

    if (atTokenStart >= 0) {
      const tokenEnd = atTokenStart + 1 + fileSearchFilter.length;
      const beforeToken = text.slice(0, atTokenStart);
      const afterToken = text.slice(tokenEnd).replace(/^\s+/, beforeToken ? '' : '');
      const spacer = beforeToken && afterToken && !/\s$/.test(beforeToken) && !/^\s/.test(afterToken) ? ' ' : '';
      const nextText = `${beforeToken}${spacer}${afterToken}`;
      const nextCursor = beforeToken.length + spacer.length;

      setText(nextText);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
    }

    closeFileSearch();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showFileSearch) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFileSelectedIndex((index) => Math.min(index + 1, Math.max(0, selectableFileResults.length - 1)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFileSelectedIndex((index) => Math.max(0, index - 1));
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && selectableFileResults[fileSelectedIndex]) {
        event.preventDefault();
        selectFileResult(selectableFileResults[fileSelectedIndex]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFileSearch();
        return;
      }
    }

    if (showSlashMenu) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashSelectedIndex((index) => Math.min(index + 1, Math.max(0, filteredCommands.length - 1)));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashSelectedIndex((index) => Math.max(0, index - 1));
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && filteredCommands[slashSelectedIndex]) {
        event.preventDefault();
        selectSlashCommand(filteredCommands[slashSelectedIndex]!);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey && !composingRef.current) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      void appendComposerFiles(files);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void appendComposerFiles(Array.from(event.dataTransfer.files));
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;
    void appendComposerFiles(Array.from(files));
    event.target.value = '';
  };

  const appendComposerFiles = async (files: File[]) => {
    let unsupportedCount = 0;

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        appendImageFile(file);
        continue;
      }

      if (!isTextLikeFile(file)) {
        unsupportedCount += 1;
        continue;
      }

      if (file.size > MAX_TEXT_ATTACHMENT_BYTES) {
        addToast({
          type: 'warning',
          message: t('chat.fileTooLarge', { name: file.name }),
          duration: 5000,
        });
        continue;
      }

      try {
        const content = await file.text();
        if (looksBinaryText(content)) {
          unsupportedCount += 1;
          continue;
        }
        addFileReference(`attachment/${file.name}`, {
          name: file.name,
          excerpt: content,
          sourceKind: 'file',
        });
      } catch (err) {
        addToast({
          type: 'error',
          message: t('chat.readFileFailed', { name: file.name, message: err instanceof Error ? err.message : String(err) }),
          duration: 6000,
        });
      }
    }

    if (unsupportedCount > 0) {
      addToast({
        type: 'warning',
        message: t('chat.unsupportedFiles', { count: unsupportedCount }),
        duration: 5000,
      });
    }
  };

  const appendImageFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const data = result.includes(',') ? result.split(',')[1] ?? '' : result;
      setAttachments((prev) => [
        ...prev,
        { data, mimeType: file.type, fileName: file.name },
      ]);
    };
    reader.readAsDataURL(file);
  };

  const openFileSearchFromButton = () => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const after = text.slice(cursor);

    if (before.endsWith('@') && (before.length === 1 || /\s/.test(before[before.length - 2]!))) {
      setAtTokenStart(before.length - 1);
      setFileSearchFilter('');
      setShowFileSearch(true);
      setShowSlashMenu(false);
      textareaRef.current?.focus();
      return;
    }

    const separator = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const nextText = `${before}${separator}@${after}`;
    const tokenStart = before.length + separator.length;
    const nextCursor = tokenStart + 1;

    setText(nextText);
    setAtTokenStart(tokenStart);
    setFileSearchFilter('');
    setShowFileSearch(true);
    setShowSlashMenu(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  function closeFileSearch() {
    setShowFileSearch(false);
    setFileSearchFilter('');
    setAtTokenStart(-1);
    setFileSearchError(null);
  }

  return (
    <div className="pi-composer-material border-t" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
      {(fileReferences.length > 0 || attachments.length > 0) && (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1 flex-wrap">
          {fileReferences.map((ref) => (
            <div
              key={ref.id}
              className="group inline-flex h-8 max-w-[260px] items-center gap-1.5 rounded-lg border border-pi-border/70 bg-pi-bg-tertiary/70 px-2 text-xs text-pi-muted"
              title={ref.path}
            >
              <FileText size={13} className="text-pi-accent flex-shrink-0" />
              <span className="truncate">
                {ref.path}{formatReferenceRange(ref)}
              </span>
              <button
                onClick={() => setFileReferences((prev) => prev.filter((item) => item.id !== ref.id))}
                className="ml-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-pi-dim opacity-70 hover:bg-pi-bg-hover hover:text-pi-error group-hover:opacity-100"
                title={t('chat.removeReference')}
              >
                <X size={10} />
              </button>
            </div>
          ))}

          {attachments.map((att, idx) => (
            <div
              key={`${att.fileName ?? 'image'}-${idx}`}
                className="group relative h-16 w-16 overflow-hidden rounded-lg border border-pi-border/70 bg-pi-bg-tertiary/70"
            >
              <img
                src={`data:${att.mimeType};base64,${att.data}`}
                alt={att.fileName ?? 'attachment'}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-0.5 left-0.5 rounded bg-pi-bg/80 p-0.5 text-pi-dim">
                <ImageIcon size={10} />
              </div>
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-pi-bg/80 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title={t('chat.removeImage')}
              >
                <X size={10} className="text-pi-error" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showSlashMenu && filteredCommands.length > 0 && (
        <div className="px-3 pb-1">
          <div className="pi-glass-menu max-h-[220px] overflow-y-auto rounded-lg">
            {filteredCommands.map((cmd, index) => (
              <button
                key={cmd.name}
                onMouseEnter={() => setSlashSelectedIndex(index)}
                onClick={() => selectSlashCommand(cmd)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  index === slashSelectedIndex ? 'bg-pi-selected-bg' : 'hover:bg-pi-bg-hover'
                )}
              >
                <Command size={12} className="text-pi-accent flex-shrink-0" />
                <span className="font-mono text-pi-accent">{cmd.name}</span>
                <span className="text-pi-dim truncate">{cmd.description}</span>
                {cmd.category && <span className="ml-auto text-[10px] text-pi-dim">{cmd.category}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <ComposerControlBar
        refEl={controlBarRef}
        openMenu={openControlMenu}
        onToggleMenu={(menu) => setOpenControlMenu((current) => current === menu ? null : menu)}
        currentModel={currentModel}
        availableModels={availableModels}
        thinkingLevel={thinkingLevel}
        permissionMode={permissionMode}
        contextUsage={contextUsage}
        activeSession={activeSession}
        onSelectModel={selectModel}
        onSelectThinking={selectThinkingLevel}
        onSelectPermission={selectPermissionMode}
        onOpenUsage={() => setRightPanel('usage')}
      />

      <div className="flex items-end gap-2 px-3 pb-2 pt-1.5">
        <button
          onClick={handleFileSelect}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          title={t('chat.attachImage')}
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <button
          onClick={openFileSearchFromButton}
          className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors',
            showFileSearch
              ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent'
              : 'border-transparent text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
          )}
          title={t('chat.referenceWorkspaceFile')}
        >
          <AtSign size={16} />
        </button>

        <div className="flex-1 relative">
          {showFileSearch && (
            <div className="pi-glass-menu absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-lg">
              <div className="flex h-8 items-center gap-2 border-b border-pi-border/70 px-3 text-xs text-pi-dim">
                <Search size={13} className="flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {fileSearchFilter ? `@${fileSearchFilter}` : t('chat.workspaceFiles')}
                </span>
                {fileSearchLoading && <Loader2 size={12} className="animate-spin" />}
              </div>
              <div className="max-h-[260px] overflow-y-auto py-1">
                {fileSearchError ? (
                  <div className="px-3 py-2 text-xs text-pi-error">{fileSearchError}</div>
                ) : selectableFileResults.length === 0 && !fileSearchLoading ? (
                  <div className="px-3 py-2 text-xs text-pi-dim">
                    {fileSearchResults.length > 0 ? t('chat.allFilesReferenced') : t('chat.noMatchingFiles')}
                  </div>
                ) : (
                  selectableFileResults.map((entry, index) => (
                    <button
                      key={entry.path}
                      onMouseEnter={() => setFileSelectedIndex(index)}
                      onClick={() => selectFileResult(entry)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                        index === fileSelectedIndex ? 'bg-pi-selected-bg text-pi-text' : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
                      )}
                      title={entry.path}
                    >
                      <FileText size={13} className="text-pi-accent flex-shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onPaste={handlePaste}
            placeholder={isStreaming ? t('chat.queuePlaceholder') : t('chat.messagePlaceholder')}
            rows={1}
            className="pi-glass-control w-full resize-none rounded-lg px-3 py-2
                       text-sm text-pi-text placeholder-pi-dim
                       focus:outline-none focus:border-pi-accent transition-colors
                       min-h-[40px] max-h-[200px]"
            style={{ fontFamily: 'inherit' }}
          />
        </div>

        {isStreaming && (
          <button
            onClick={onStop}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-pi-error/20 text-pi-error transition-colors hover:bg-pi-error/30"
            title={t('chat.stopGeneration')}
          >
            <Square size={14} fill="currentColor" />
          </button>
        )}

        {(!isStreaming || canSubmit) && (
          <button
            onClick={() => void handleSend()}
            disabled={!canSubmit || isPreparingPrompt}
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
              canSubmit && !isPreparingPrompt
                ? 'bg-pi-accent text-white hover:bg-pi-accent/90'
                : 'cursor-not-allowed bg-pi-bg-tertiary/70 text-pi-dim'
            )}
            title={isStreaming ? t('chat.queueFollowUp') : t('chat.sendMessage')}
          >
            {isPreparingPrompt ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}

interface ComposerContextUsage {
  estimatedTokens: number;
  contextWindow: number;
  percent: number;
  label: string;
}

function ComposerControlBar({
  refEl,
  openMenu,
  onToggleMenu,
  currentModel,
  availableModels,
  thinkingLevel,
  permissionMode,
  contextUsage,
  activeSession,
  onSelectModel,
  onSelectThinking,
  onSelectPermission,
  onOpenUsage,
}: {
  refEl: RefObject<HTMLDivElement | null>;
  openMenu: 'model' | 'permission' | 'thinking' | null;
  onToggleMenu: (menu: 'model' | 'permission' | 'thinking') => void;
  currentModel: ModelInfo | null;
  availableModels: ModelInfo[];
  thinkingLevel: ThinkingLevel;
  permissionMode: PermissionMode;
  contextUsage: ComposerContextUsage;
  activeSession?: Session;
  onSelectModel: (model: ModelInfo) => void;
  onSelectThinking: (level: ThinkingLevel) => void;
  onSelectPermission: (mode: PermissionMode) => void;
  onOpenUsage: () => void;
}) {
  const { t } = useI18n();
  const selectedPermission = PERMISSION_MODE_OPTIONS.find((option) => option === permissionMode) ?? PERMISSION_MODE_OPTIONS[0]!;

  return (
    <div ref={refEl} className="relative flex items-center gap-1.5 px-3 pt-2">
      <ComposerControlButton
        icon={<Bot size={12} />}
        label={currentModel?.name ?? t('chat.noModel')}
        active={openMenu === 'model'}
        title={t('chat.modelTitle')}
        onClick={() => onToggleMenu('model')}
      />
      <ComposerControlButton
        icon={<Shield size={12} />}
        label={permissionModeLabel(selectedPermission, t)}
        active={openMenu === 'permission'}
        tone={permissionMode === 'bypassPermissions' ? 'warning' : undefined}
        title={t('chat.permissionMode')}
        onClick={() => onToggleMenu('permission')}
      />
      <ComposerControlButton
        icon={<Brain size={12} />}
        label={thinkingLevelLabel(thinkingLevel, t)}
        active={openMenu === 'thinking'}
        title={t('chat.thinkingLevel')}
        onClick={() => onToggleMenu('thinking')}
      />
      {activeSession && <WorkspaceSwitcher activeSession={activeSession} placement="toolbar" />}
      <button
        onClick={onOpenUsage}
        className={cn(
          'flex h-7 min-w-0 max-w-[190px] flex-shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] transition-colors',
          contextUsage.percent > 85
            ? 'border-pi-error/40 bg-pi-error/10 text-pi-error'
            : contextUsage.percent > 65
              ? 'border-pi-warning/40 bg-pi-warning/10 text-pi-warning'
              : 'border-pi-border/70 bg-pi-bg-secondary/70 text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
        )}
        title={t('chat.openTokenUsage')}
      >
        <Gauge size={12} className="flex-shrink-0" />
        <span className="truncate">{contextUsage.label}</span>
      </button>

      {openMenu === 'model' && (
        <div className="pi-glass-menu absolute bottom-full left-3 z-50 mb-2 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-lg">
          <div className="border-b border-pi-border/70 px-3 py-2 text-[10px] font-semibold uppercase text-pi-dim">{t('chat.modelTitle')}</div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {availableModels.length === 0 ? (
              <div className="px-3 py-2 text-xs text-pi-dim">{t('chat.noModels')}</div>
            ) : (
              availableModels.map((model) => (
                <button
                  key={`${model.provider}/${model.id}`}
                  onClick={() => onSelectModel(model)}
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-pi-bg-hover',
                    currentModel?.id === model.id && currentModel.provider === model.provider ? 'bg-pi-selected-bg text-pi-text' : 'text-pi-muted'
                  )}
                >
                  <Bot size={13} className="mt-0.5 flex-shrink-0 text-pi-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-pi-text">{model.name}</span>
                    <span className="block truncate text-[10px] text-pi-dim">
                      {model.provider} · {formatCompactNumber(model.contextWindow)} {t('chat.context')}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {openMenu === 'permission' && (
        <div className="pi-glass-menu absolute bottom-full left-3 z-50 mb-2 w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-lg">
          <div className="border-b border-pi-border/70 px-3 py-2 text-[10px] font-semibold uppercase text-pi-dim">{t('chat.permissionTitle')}</div>
          <div className="py-1">
            {PERMISSION_MODE_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => onSelectPermission(option)}
                className={cn(
                  'flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-pi-bg-hover',
                  permissionMode === option ? 'bg-pi-selected-bg text-pi-text' : 'text-pi-muted'
                )}
              >
                <Shield size={13} className="mt-0.5 flex-shrink-0 text-pi-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-pi-text">{permissionModeLabel(option, t)}</span>
                  <span className="block text-[10px] leading-relaxed text-pi-dim">{permissionModeDescription(option, t)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {openMenu === 'thinking' && (
        <div className="pi-glass-menu absolute bottom-full left-3 z-50 mb-2 w-[min(260px,calc(100vw-32px))] overflow-hidden rounded-lg">
          <div className="border-b border-pi-border/70 px-3 py-2 text-[10px] font-semibold uppercase text-pi-dim">{t('chat.thinkingTitle')}</div>
          <div className="grid grid-cols-2 gap-1 p-2">
            {THINKING_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => onSelectThinking(level)}
                className={cn(
                  'h-8 rounded-md px-2 text-xs capitalize transition-colors',
                  thinkingLevel === level
                    ? 'bg-pi-selected-bg text-pi-accent'
                    : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
                )}
              >
                {thinkingLevelLabel(level, t)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ComposerControlButton({
  icon,
  label,
  active,
  tone,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  tone?: 'warning';
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-7 min-w-0 max-w-[180px] items-center gap-1.5 rounded-lg border px-2 text-[11px] transition-colors',
        active
          ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent'
          : tone === 'warning'
            ? 'border-pi-warning/40 bg-pi-warning/10 text-pi-warning hover:bg-pi-warning/15'
            : 'border-pi-border/70 bg-pi-bg-secondary/70 text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
      )}
      title={title}
    >
      <span className="flex-shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function permissionModeLabel(
  mode: PermissionMode,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  return t(`chat.permission.${mode}.label` as TranslationKey);
}

function permissionModeDescription(
  mode: PermissionMode,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  return t(`chat.permission.${mode}.description` as TranslationKey);
}

function thinkingLevelLabel(
  level: ThinkingLevel,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  return t(`chat.thinking.${level}` as TranslationKey);
}

async function buildPromptWithReferences(
  sessionId: string,
  references: WorkspaceFileReference[],
  userText: string
): Promise<string> {
  const blocks = await Promise.all(
    references.map(async (reference) => {
      if (reference.excerpt !== undefined) {
        return formatReferenceExcerptBlock(reference);
      }

      try {
        const file = await piApi.getWorkspaceFile(sessionId, reference.path);
        return formatReferenceBlock(reference, file);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return `<file path="${escapeAttr(reference.path)}">\n[Unable to read file: ${reason}]\n</file>`;
      }
    })
  );

  const context = [
    '<workspace_context>',
    'The user attached these workspace files as context.',
    ...blocks,
    '</workspace_context>',
  ].join('\n\n');

  return [context, userText].filter(Boolean).join('\n\n');
}

function formatReferenceBlock(reference: WorkspaceFileReference, file: WorkspaceReadFileResult): string {
  const language = file.language || languageFromPath(reference.path);
  const range = normalizedReferenceRange(reference);
  const rangeAttrs = range ? ` lineStart="${range.start}" lineEnd="${range.end}"` : '';
  const attrs = `path="${escapeAttr(reference.path)}" language="${escapeAttr(language)}"${rangeAttrs}`;

  if ((file.state === 'ok' || file.state === 'too_large') && file.previewType === 'text' && file.content !== undefined) {
    const sourceContent = range ? sliceLines(file.content, range.start, range.end) : file.content;
    const content = sourceContent.length > MAX_REFERENCE_CHARS
      ? `${sourceContent.slice(0, MAX_REFERENCE_CHARS)}\n...[truncated for prompt]`
      : sourceContent;
    return `<file ${attrs}>\n${content}\n</file>`;
  }

  if (file.state === 'ok' && file.previewType === 'image') {
    return `<file ${attrs}>\n[Image file: ${file.mimeType ?? 'image'}, ${formatBytes(file.size)}]\n</file>`;
  }

  if (file.state === 'too_large') {
    return `<file ${attrs}>\n[File is too large to inline: ${formatBytes(file.size)}]\n</file>`;
  }

  if (file.state === 'binary') {
    return `<file ${attrs}>\n[Binary file: ${formatBytes(file.size)}]\n</file>`;
  }

  if (file.state === 'missing') {
    return `<file ${attrs}>\n[File is missing]\n</file>`;
  }

  return `<file ${attrs}>\n[Unable to read file${file.error ? `: ${file.error}` : ''}]\n</file>`;
}

function formatReferenceExcerptBlock(reference: WorkspaceFileReference): string {
  const range = normalizedReferenceRange(reference);
  const rangeAttrs = range ? ` lineStart="${range.start}" lineEnd="${range.end}"` : '';
  const kindAttr = reference.sourceKind ? ` kind="${reference.sourceKind}"` : '';
  const language = reference.sourceKind === 'diff' ? 'diff' : languageFromPath(reference.path);
  const attrs = `path="${escapeAttr(reference.path)}" language="${escapeAttr(language)}"${rangeAttrs}${kindAttr}`;
  const excerpt = (reference.excerpt ?? '').length > MAX_REFERENCE_CHARS
    ? `${reference.excerpt?.slice(0, MAX_REFERENCE_CHARS)}\n...[truncated for prompt]`
    : reference.excerpt ?? '';
  return `<file_selection ${attrs}>\n${excerpt}\n</file_selection>`;
}

function buildDisplayText(userText: string, references: WorkspaceFileReference[]): string {
  const referenceLine = references.map((reference) => `@${reference.path}${formatReferenceRange(reference)}`).join(' ');
  return [referenceLine, userText].filter(Boolean).join('\n\n');
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function normalizeLineNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizedReferenceRange(reference: WorkspaceFileReference): { start: number; end: number } | undefined {
  const start = normalizeLineNumber(reference.lineStart);
  const end = normalizeLineNumber(reference.lineEnd) ?? start;
  if (!start || !end) return undefined;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function formatReferenceRange(reference: WorkspaceFileReference): string {
  const range = normalizedReferenceRange(reference);
  if (!range) return '';
  return range.start === range.end ? `:L${range.start}` : `:L${range.start}-L${range.end}`;
}

function sliceLines(value: string, start: number, end: number): string {
  return value.split('\n').slice(start - 1, end).join('\n');
}

function basename(value: string): string {
  const normalized = normalizeWorkspacePath(value);
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function languageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext || ext === filePath) return 'text';
  return ext;
}

function localizeFallbackSlashCommands(
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): SlashCommandInfo[] {
  return FALLBACK_SLASH_COMMANDS.map((command) => ({
    name: command.name,
    description: t(command.descriptionKey),
    category: t(command.categoryKey),
    source: command.source,
  }));
}

function mergeSlashCommands(commands: SlashCommandInfo[], fallbackCommands: SlashCommandInfo[]): SlashCommandInfo[] {
  const merged = [...commands, ...fallbackCommands];
  const seen = new Set<string>();
  const result: SlashCommandInfo[] = [];

  for (const command of merged) {
    const name = normalizeSlashName(command.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({ ...command, name, insertText: command.insertText ?? `${name} ` });
  }

  return result.sort((a, b) => {
    const category = (a.category ?? '').localeCompare(b.category ?? '');
    return category !== 0 ? category : a.name.localeCompare(b.name);
  });
}

function normalizeSlashName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function modelForSession(session: Session | undefined, models: ModelInfo[], fallback: ModelInfo | null): ModelInfo | null {
  if (!session) return fallback;
  const provider = session.modelProvider;
  return models.find((model) => model.id === session.modelId && (!provider || model.provider === provider))
    ?? models.find((model) => model.id === session.modelId)
    ?? fallback;
}

function estimateComposerContext(
  messages: ChatMessage[],
  text: string,
  references: WorkspaceFileReference[],
  attachments: ImageAttachment[],
  currentModel: ModelInfo | null,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): ComposerContextUsage {
  const messageChars = messages.reduce((total, message) => total + messageTextLength(message), 0);
  const referenceChars = references.reduce((total, reference) => {
    if (reference.excerpt !== undefined) return total + reference.excerpt.length;
    return total + Math.max(300, reference.path.length * 3);
  }, 0);
  const imageChars = attachments.reduce((total, attachment) => total + Math.ceil(attachment.data.length * 0.75), 0);
  const estimatedTokens = Math.ceil((messageChars + text.length + referenceChars + imageChars) / 4);
  const contextWindow = currentModel?.contextWindow ?? 0;
  const percent = contextWindow > 0 ? Math.min(100, (estimatedTokens / contextWindow) * 100) : 0;
  const label = contextWindow > 0
    ? `${formatCompactNumber(estimatedTokens)} / ${formatCompactNumber(contextWindow)}`
    : t('chat.tokens', { count: formatCompactNumber(estimatedTokens) });

  return { estimatedTokens, contextWindow, percent, label };
}

function messageTextLength(message: ChatMessage): number {
  const contentChars = message.content.reduce((total, part) => {
    if (part.type === 'text') return total + (part.text?.length ?? 0);
    if (part.type === 'thinking') return total + (part.thinking?.content.length ?? 0);
    if (part.type === 'tool_use') return total + JSON.stringify(part.toolUse?.args ?? {}).length;
    if (part.type === 'tool_result') return total + (part.toolResult?.content.length ?? 0);
    return total;
  }, 0);

  return contentChars + (message.thinking?.content.length ?? 0);
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  if (file.type === 'application/json' || file.type === 'application/xml') return true;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return Boolean(ext && TEXT_ATTACHMENT_EXTENSIONS.has(ext));
}

function looksBinaryText(value: string): boolean {
  if (!value) return false;
  const sample = value.slice(0, 4096);
  return sample.includes('\u0000');
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
