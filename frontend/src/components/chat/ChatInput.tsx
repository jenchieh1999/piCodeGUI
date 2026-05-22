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
  PromptOptimizeFileReference,
  PromptOptimizeImageReference,
  PromptOptimizeMode,
  PromptOptimizeResult,
  PromptOptimizeSessionContext,
  PromptOptimizeWorkspaceContext,
  Session,
  SlashCommandInfo,
  ThinkingLevel,
  WorkspaceReadFileResult,
  WorkspaceTreeEntry,
} from '../../types';
import { piApi } from '../../api/client';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { createNewSessionFromPicker, openProjectsLauncher } from '../../lib/sessionActions';
import { thinkingLevelPillClass, thinkingLevelTextClass } from '../../lib/thinkingLevelStyles';
import { hasWorkspaceFileDragPayload, readWorkspaceFileDragPayload, type WorkspaceFileDragPayload } from '../../lib/workspaceDrag';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { useModelStore } from '../../stores/modelStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAgentRoomStore } from '../../stores/agentRoomStore';
import { cn } from '../shared/utils';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import {
  AtSign,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Command,
  Copy,
  FileText,
  Gauge,
  Image as ImageIcon,
  Loader2,
  Network,
  Paperclip,
  Pencil,
  Search,
  Send,
  Shield,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';

interface ChatInputProps {
  onSend: (
    text: string,
    images?: ImageAttachment[],
    displayText?: string,
    mode?: ChatInputSendMode,
    draft?: QueuedFollowUpDraft
  ) => boolean | void;
  onStop: () => void;
  isStreaming: boolean;
  sessionId: string;
  queuedFollowUps?: QueuedFollowUpItem[];
  onEditQueuedFollowUp?: (id: string) => void;
  onDeleteQueuedFollowUp?: (id: string) => void;
  onGuideQueuedFollowUp?: (id: string) => void;
}

type ChatInputSendMode = 'prompt' | 'steer' | 'follow_up';
type StreamingSendMode = Extract<ChatInputSendMode, 'steer' | 'follow_up'>;

export interface WorkspaceFileReference {
  id: string;
  path: string;
  name: string;
  lineStart?: number;
  lineEnd?: number;
  excerpt?: string;
  sourceKind?: 'file' | 'diff';
}

export interface QueuedFollowUpDraft {
  text: string;
  attachments: ImageAttachment[];
  fileReferences: WorkspaceFileReference[];
}

export interface QueuedFollowUpItem {
  id: string;
  text: string;
  displayText: string;
  images?: ImageAttachment[];
  draft?: QueuedFollowUpDraft;
  createdAt: number;
}

interface ComposerDraft {
  text: string;
  attachments: ImageAttachment[];
  fileReferences: WorkspaceFileReference[];
}

interface PromptOptimizationSnapshot {
  originalText: string;
  optimizedText: string;
  selectionStart: number;
  selectionEnd: number;
}

interface PromptOptimizationPreview {
  id: string;
  originalText: string;
  optimizedText: string;
  replacementText: string;
  selectionStart: number;
  selectionEnd: number;
  nextSelectionStart: number;
  nextSelectionEnd: number;
  selectionOnly: boolean;
  result: PromptOptimizeResult;
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
  { name: '/test', descriptionKey: 'chat.slash.test', categoryKey: 'chat.category.code', source: 'builtin' },
  { name: '/explain', descriptionKey: 'chat.slash.explain', categoryKey: 'chat.category.code', source: 'builtin' },
  { name: '/compact', descriptionKey: 'chat.slash.compact', categoryKey: 'chat.category.session', source: 'builtin' },
  { name: '/clear', descriptionKey: 'chat.slash.clear', categoryKey: 'chat.category.session', source: 'builtin' },
  { name: '/tree', descriptionKey: 'chat.slash.tree', categoryKey: 'chat.category.session', source: 'builtin' },
  { name: '/fork', descriptionKey: 'chat.slash.fork', categoryKey: 'chat.category.session', source: 'builtin' },
  { name: '/new', descriptionKey: 'chat.slash.new', categoryKey: 'chat.category.session', source: 'builtin' },
  { name: '/projects', descriptionKey: 'chat.slash.projects', categoryKey: 'chat.category.session', source: 'builtin' },
  { name: '/memory', descriptionKey: 'chat.slash.memory', categoryKey: 'chat.category.runtime', source: 'builtin' },
];

const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const PERMISSION_MODE_OPTIONS: PermissionMode[] = ['ask', 'acceptEdits', 'plan', 'bypassPermissions'];
const PROMPT_OPTIMIZE_MODES: PromptOptimizeMode[] = ['auto', 'polish', 'execute', 'debug', 'review', 'research', 'ui', 'agent_room'];

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  sessionId,
  queuedFollowUps = [],
  onEditQueuedFollowUp,
  onDeleteQueuedFollowUp,
  onGuideQueuedFollowUp,
}: ChatInputProps) {
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
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [lastPromptOptimization, setLastPromptOptimization] = useState<PromptOptimizationSnapshot | null>(null);
  const [promptOptimizationPreview, setPromptOptimizationPreview] = useState<PromptOptimizationPreview | null>(null);
  const [promptOptimizeMode, setPromptOptimizeMode] = useState<PromptOptimizeMode>('auto');
  const [showPromptOptimizeMenu, setShowPromptOptimizeMenu] = useState(false);
  const [streamingSendMode, setStreamingSendMode] = useState<StreamingSendMode>('follow_up');
  const [openControlMenu, setOpenControlMenu] = useState<'model' | 'permission' | 'thinking' | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptOptimizeMenuRef = useRef<HTMLDivElement>(null);
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
  const setActiveView = useUIStore((s) => s.setActiveView);
  const runtimeSlashCommands = useUIStore((s) => s.slashCommands);
  const messages = useChatStore((s) => s.messagesBySession[sessionId] ?? EMPTY_MESSAGES);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === sessionId));
  const queueState = useChatStore((s) => s.queueBySession[sessionId]);
  const globalCurrentModel = useModelStore((s) => s.currentModel);
  const availableModels = useModelStore((s) => s.availableModels);
  const globalThinkingLevel = useModelStore((s) => s.thinkingLevel);
  const permissionMode = useSettingsStore((s) => s.permissionMode);
  const promptOptimizerModel = useSettingsStore((s) => s.promptOptimizerModel);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const currentModel = useMemo(
    () => modelForSession(activeSession, availableModels, globalCurrentModel),
    [activeSession, availableModels, globalCurrentModel]
  );
  const thinkingLevel = activeSession?.thinkingLevel ?? globalThinkingLevel;
  const queueCounts = queueState ?? { steering: 0, followUp: 0 };

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
      setLastPromptOptimization(null);
      setPromptOptimizationPreview(null);
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

  useEffect(() => {
    if (!showPromptOptimizeMenu) return;

    const close = (event: globalThis.MouseEvent) => {
      if (promptOptimizeMenuRef.current?.contains(event.target as Node)) return;
      setShowPromptOptimizeMenu(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setShowPromptOptimizeMenu(false);
    };

    window.addEventListener('click', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showPromptOptimizeMenu]);

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
    const dispose = window.piDesktop?.onWorkspaceReference((detail) => {
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
    });

    return () => dispose?.();
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
    }, 180);

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
    if (lastPromptOptimization && value !== lastPromptOptimization.optimizedText) {
      setLastPromptOptimization(null);
    }
    if (promptOptimizationPreview && value !== promptOptimizationPreview.originalText) {
      setPromptOptimizationPreview(null);
    }
    if (!detectSlashTrigger(value, cursorPos)) {
      detectAtTrigger(value, cursorPos);
    }
  };

  const handleSend = async () => {
    if (isPreparingPrompt || !canSubmit) return;

    const trimmed = text.trim();
    if (attachments.length === 0 && fileReferences.length === 0 && await runWorkbenchSlashCommand(trimmed)) {
      clearComposer();
      closeFileSearch();
      setShowSlashMenu(false);
      textareaRef.current?.focus();
      return;
    }

    const references = fileReferences;
    const images = attachments.length > 0 ? attachments : undefined;
    const draft: QueuedFollowUpDraft = {
      text,
      attachments,
      fileReferences,
    };

    setIsPreparingPrompt(true);
    try {
      const modelText = references.length > 0
        ? await buildPromptWithReferences(sessionId, references, trimmed)
        : trimmed;
      const displayText = buildDisplayText(trimmed, references);

      const sendMode: ChatInputSendMode = isStreaming ? streamingSendMode : 'prompt';
      const sent = onSend(modelText, images, displayText, sendMode, draft);
      if (sent === false) return;

      clearComposer();
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

  const clearComposer = () => {
    setText('');
    setAttachments([]);
    setFileReferences([]);
    setLastPromptOptimization(null);
    setPromptOptimizationPreview(null);
    draftsRef.current[sessionId] = { text: '', attachments: [], fileReferences: [] };
  };

  const editQueuedFollowUp = (item: QueuedFollowUpItem) => {
    onEditQueuedFollowUp?.(item.id);
    const draft = item.draft;
    const restoredText = draft?.text ?? item.displayText ?? item.text;
    const restoredAttachments = draft?.attachments ?? item.images ?? [];
    const restoredReferences = draft?.fileReferences ?? [];

    setText(restoredText);
    setAttachments(restoredAttachments);
    setFileReferences(restoredReferences);
    setLastPromptOptimization(null);
    setPromptOptimizationPreview(null);
    closeFileSearch();
    setShowSlashMenu(false);
    draftsRef.current[sessionId] = {
      text: restoredText,
      attachments: restoredAttachments,
      fileReferences: restoredReferences,
    };

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const cursor = restoredText.length;
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const runWorkbenchSlashCommand = async (value: string): Promise<boolean> => {
    const command = value.split(/\s+/)[0]?.toLowerCase();
    if (!command) return false;

    switch (command) {
      case '/projects': {
        openProjectsLauncher();
        addToast({ type: 'info', message: t('chat.command.projectsOpened') });
        return true;
      }
      case '/new': {
        await createNewSessionFromPicker();
        return true;
      }
      case '/clear': {
        const sent = piApi.send({ type: 'session_clear', sessionId });
        if (!sent) {
          addToast({
            type: 'error',
            message: t('chat.command.clearDisconnected'),
            duration: 6000,
          });
          return true;
        }
        useChatStore.getState().clearMessages(sessionId);
        useChatStore.getState().stopStreaming(sessionId);
        addToast({ type: 'success', message: t('chat.command.cleared') });
        return true;
      }
      default:
        return false;
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
      return;
    }
    if (activeSession) {
      useChatStore.getState().updateSession({ ...activeSession, thinkingLevel: level, updatedAt: Date.now() });
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
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'z' &&
      lastPromptOptimization &&
      text === lastPromptOptimization.optimizedText
    ) {
      event.preventDefault();
      undoPromptOptimization();
      return;
    }

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

  const resolveDroppedWorkspaceReference = useCallback(async (
    payload: WorkspaceFileDragPayload
  ): Promise<{ path: string; name: string } | null> => {
    if (payload.isDirectory) {
      addToast({ type: 'warning', message: t('chat.workspaceDropFolderUnsupported') });
      return null;
    }

    if (payload.sessionId === sessionId) {
      return { path: payload.path, name: payload.name };
    }

    try {
      const [sourceWorkspace, targetWorkspace] = await Promise.all([
        piApi.getWorkspaceStatus(payload.sessionId),
        piApi.getWorkspaceStatus(sessionId),
      ]);

      if (
        sourceWorkspace.state === 'ok' &&
        targetWorkspace.state === 'ok' &&
        sameWorkspaceRoot(sourceWorkspace.workDir, targetWorkspace.workDir)
      ) {
        return { path: payload.path, name: payload.name };
      }
    } catch {
      // Fall back to the existing different-session warning below.
    }

    addToast({ type: 'warning', message: t('chat.workspaceDropDifferentSession') });
    return null;
  }, [addToast, sessionId, t]);

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const workspacePayload = readWorkspaceFileDragPayload(event.dataTransfer);
    if (workspacePayload) {
      const reference = await resolveDroppedWorkspaceReference(workspacePayload);
      if (reference) {
        addFileReference(reference.path, { name: reference.name });
        textareaRef.current?.focus();
      }
      return;
    }

    const plainPath = readPlainDroppedPath(event.dataTransfer);
    if (plainPath) {
      addFileReference(plainPath, { name: basename(plainPath) });
      textareaRef.current?.focus();
      return;
    }

    await appendComposerFiles(Array.from(event.dataTransfer.files));
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

  const undoPromptOptimization = () => {
    const snapshot = lastPromptOptimization;
    if (!snapshot) return;

    setText(snapshot.originalText);
    setLastPromptOptimization(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    });
    addToast({ type: 'info', message: t('chat.optimizePromptUndone') });
  };

  const acceptPromptOptimizationPreview = () => {
    const preview = promptOptimizationPreview;
    if (!preview) return;

    setLastPromptOptimization({
      originalText: preview.originalText,
      optimizedText: preview.replacementText,
      selectionStart: preview.selectionStart,
      selectionEnd: preview.selectionEnd,
    });
    setText(preview.replacementText);
    setPromptOptimizationPreview(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(preview.nextSelectionStart, preview.nextSelectionEnd);
    });
    addToast({
      type: 'success',
      message: preview.selectionOnly ? t('chat.optimizePromptSelectionDone') : t('chat.optimizePromptDone'),
    });
  };

  const copyPromptOptimizationPreview = async () => {
    const preview = promptOptimizationPreview;
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.optimizedText);
      addToast({ type: 'success', message: t('chat.optimizePromptCopied') });
    } catch (err) {
      addToast({
        type: 'error',
        message: t('chat.optimizePromptCopyFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  const optimizeComposerPrompt = async () => {
    if (isOptimizingPrompt) return;

    const sourceText = text.trim();
    if (!sourceText) {
      addToast({ type: 'warning', message: t('chat.optimizePromptEmpty') });
      return;
    }

    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? 0;
    const selectionEnd = textarea?.selectionEnd ?? 0;
    const hasSelection = selectionEnd > selectionStart;
    const selectedText = hasSelection ? text.slice(selectionStart, selectionEnd).trim() : '';
    const targetText = selectedText || sourceText;

    setIsOptimizingPrompt(true);
    setShowPromptOptimizeMenu(false);
    const optimizationContext = {
      mode: promptOptimizeMode,
      projectName: activeSession?.projectName,
      projectPath: activeSession?.projectPath,
      hasFileReferences: fileReferences.length > 0,
      hasImages: attachments.length > 0,
      fileReferences: buildPromptFileReferences(fileReferences),
      imageReferences: buildPromptImageReferences(attachments),
      sessionContext: buildPromptSessionContext(activeSession, messages),
    };

    try {
      const workspaceContext = await collectPromptWorkspaceContext(sessionId);
      const result = await piApi.optimizePrompt({
        text: targetText,
        ...optimizationContext,
        workspaceContext,
        language: detectPromptLanguage(targetText),
        selectionOnly: hasSelection,
        sessionId,
        currentModel: currentModel ? { provider: currentModel.provider, id: currentModel.id } : undefined,
        preferredOptimizerModel: promptOptimizerModel ?? undefined,
      });
      const optimized = result.optimized.trim();
      if (!optimized) throw new Error(result.warning || t('chat.optimizePromptEmptyResult'));

      let nextText = optimized;
      let nextSelectionStart = optimized.length;
      let nextSelectionEnd = optimized.length;
      if (hasSelection && selectedText) {
        const before = text.slice(0, selectionStart);
        const after = text.slice(selectionEnd);
        nextText = `${before}${optimized}${after}`;
        nextSelectionStart = before.length;
        nextSelectionEnd = before.length + optimized.length;
      }

      setLastPromptOptimization(null);
      setPromptOptimizationPreview({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        originalText: text,
        optimizedText: optimized,
        replacementText: nextText,
        selectionStart,
        selectionEnd,
        nextSelectionStart,
        nextSelectionEnd,
        selectionOnly: hasSelection,
        result,
      });

      closeFileSearch();
      setShowSlashMenu(false);
      addToast({
        type: result.changedIntentRisk === 'high' ? 'warning' : 'success',
        message: t('chat.optimizePromptPreviewReady', {
          source: promptOptimizeSourceLabel(result, t),
          score: result.qualityScore ?? '-',
        }),
        duration: result.warning ? 6000 : undefined,
      });
    } catch (err) {
      console.warn('[ChatInput] Prompt optimizer unavailable:', err);
      addToast({
        type: 'error',
        message: t('chat.optimizePromptFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    } finally {
      setIsOptimizingPrompt(false);
    }
  };

  const launchAgentRoom = async () => {
    const question = text.trim() || activeSession?.title || '';
    if (!question) {
      addToast({ type: 'warning', message: t('agentsRoom.questionRequired') });
      return;
    }

    try {
      const result = await piApi.createAgentRoom({
        sessionId,
        projectPath: activeSession?.projectPath,
        question,
        mode: 'balanced',
        leftLabel: t('agentsRoom.defaultLeft'),
        rightLabel: t('agentsRoom.defaultRight'),
        neutralLabel: t('agentsRoom.defaultNeutral'),
        debateRounds: 2,
        quickModel: currentModel ? { provider: currentModel.provider, id: currentModel.id } : undefined,
        deepModel: currentModel ? { provider: currentModel.provider, id: currentModel.id } : undefined,
        useWorkspaceSearch: true,
        useWebSearch: false,
      });
      useAgentRoomStore.getState().setSnapshot(result.snapshot);
      useAgentRoomStore.getState().setActiveRoom(result.room.id);
      setActiveView('agentRooms');
      void piApi.startAgentRoomRun(result.room.id).then((runResult) => {
        useAgentRoomStore.getState().upsertRoom(runResult.room);
        useAgentRoomStore.getState().upsertRun(runResult.run);
      });
      setText('');
      closeFileSearch();
      setShowSlashMenu(false);
    } catch (err) {
      addToast({
        type: 'error',
        message: t('agentsRoom.createFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  function closeFileSearch() {
    setShowFileSearch(false);
    setFileSearchFilter('');
    setAtTokenStart(-1);
    setFileSearchError(null);
  }

  return (
    <div
      className="pi-composer-material relative z-[45] overflow-visible border-t"
      onDrop={(event) => void handleDrop(event)}
      onDragOver={(event) => {
        event.preventDefault();
        if (hasWorkspaceFileDragPayload(event.dataTransfer) || readPlainDroppedPath(event.dataTransfer)) {
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
    >
      {(fileReferences.length > 0 || attachments.length > 0) && (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1 flex-wrap">
          {fileReferences.map((ref) => (
            <div
              key={ref.id}
              className="group inline-flex h-10 max-w-[320px] items-center gap-2 rounded-2xl border border-pi-border/70 bg-pi-bg-secondary/80 px-2.5 text-xs text-pi-muted shadow-sm backdrop-blur-xl"
              title={ref.path}
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-pi-accent/20 bg-pi-accent/10 text-pi-accent shadow-inner">
                <FileText size={13} />
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-semibold text-pi-text">{ref.name || basename(ref.path)}</span>
                <span className="block truncate text-[10px] text-pi-dim">
                  {referenceDirectoryLabel(ref.path)}
                  {formatReferenceRange(ref) && <span className="font-mono"> {formatReferenceRange(ref)}</span>}
                </span>
              </span>
              <button
                onClick={() => setFileReferences((prev) => prev.filter((item) => item.id !== ref.id))}
                className="ml-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-pi-dim opacity-70 transition-colors hover:bg-pi-bg-hover hover:text-pi-error group-hover:opacity-100"
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

      {promptOptimizationPreview && (
        <div className="px-3 pb-2">
          <div className="rounded-xl border border-pi-accent/20 bg-pi-bg-elevated/95 p-3 shadow-lg">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pi-accent/12 text-pi-accent">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-pi-text">{t('chat.optimizePromptPreviewTitle')}</div>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-pi-dim">
                  <span className="rounded-full border border-pi-border/70 px-2 py-0.5">
                    {promptOptimizeModeLabel(promptOptimizationPreview.result.mode ?? promptOptimizeMode, t)}
                  </span>
                  <span className="rounded-full border border-pi-border/70 px-2 py-0.5">
                    {promptOptimizeSourceLabel(promptOptimizationPreview.result, t)}
                  </span>
                  {typeof promptOptimizationPreview.result.qualityScore === 'number' && (
                    <span className="rounded-full border border-pi-border/70 px-2 py-0.5">
                      {t('chat.optimizePromptScore', { score: promptOptimizationPreview.result.qualityScore })}
                    </span>
                  )}
                  {promptOptimizationPreview.result.changedIntentRisk && (
                    <span className={cn(
                      'rounded-full border px-2 py-0.5',
                      promptOptimizationRiskClass(promptOptimizationPreview.result.changedIntentRisk)
                    )}>
                      {promptOptimizationRiskLabel(promptOptimizationPreview.result.changedIntentRisk, t)}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setPromptOptimizationPreview(null)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                title={t('common.close')}
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-pi-border/60 bg-pi-bg/70 p-2">
                <div className="mb-1 text-[10px] font-medium uppercase text-pi-dim">{t('chat.optimizePromptBefore')}</div>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-pi-muted">{promptOptimizationPreview.selectionOnly
                    ? promptOptimizationPreview.originalText.slice(promptOptimizationPreview.selectionStart, promptOptimizationPreview.selectionEnd)
                    : promptOptimizationPreview.originalText}</pre>
              </div>
              <div className="min-w-0 rounded-lg border border-pi-accent/20 bg-pi-accent/5 p-2">
                <div className="mb-1 text-[10px] font-medium uppercase text-pi-accent">{t('chat.optimizePromptAfter')}</div>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-pi-text">{promptOptimizationPreview.optimizedText}</pre>
              </div>
            </div>

            {(promptOptimizationPreview.result.warning || promptOptimizationPreview.result.warnings?.length) && (
              <div className="mt-2 rounded-lg border border-pi-warning/25 bg-pi-warning/10 px-2.5 py-2 text-[11px] leading-relaxed text-pi-warning">
                {(promptOptimizationPreview.result.warnings ?? [promptOptimizationPreview.result.warning]).filter(Boolean).slice(0, 3).join(' · ')}
              </div>
            )}

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => void copyPromptOptimizationPreview()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-pi-border/70 px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
              >
                <Copy size={13} />
                {t('common.copy')}
              </button>
              <button
                onClick={() => void optimizeComposerPrompt()}
                disabled={isOptimizingPrompt}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-pi-border/70 px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isOptimizingPrompt ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {t('chat.optimizePromptRegenerate')}
              </button>
              <button
                onClick={acceptPromptOptimizationPreview}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-pi-accent px-3 text-xs font-medium text-white transition-colors hover:bg-pi-accent/90"
              >
                <Check size={13} />
                {t('chat.optimizePromptAccept')}
              </button>
            </div>
          </div>
        </div>
      )}

      {queuedFollowUps.length > 0 && (
        <QueuedFollowUpCards
          items={queuedFollowUps}
          onEdit={editQueuedFollowUp}
          onDelete={(id) => onDeleteQueuedFollowUp?.(id)}
          onGuide={(id) => onGuideQueuedFollowUp?.(id)}
        />
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

      <div className="flex items-center gap-2 px-3 pb-2 pt-1.5">
        <button
          onClick={handleFileSelect}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
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
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border transition-colors',
            showFileSearch
              ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent'
              : 'border-transparent text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
          )}
          title={t('chat.referenceWorkspaceFile')}
        >
          <AtSign size={16} />
        </button>

        {false && (
        <div className="hidden" aria-hidden="true">
          <button
            onClick={optimizeComposerPrompt}
            disabled={!text.trim() || isOptimizingPrompt || isPreparingPrompt}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-l-xl border border-r-0 transition-colors',
              text.trim() && !isOptimizingPrompt && !isPreparingPrompt
                ? 'border-pi-accent/25 bg-pi-accent/10 text-pi-accent hover:bg-pi-accent/15'
                : 'cursor-not-allowed border-transparent text-pi-dim opacity-60'
            )}
            title={`${t('chat.optimizePrompt')} · ${promptOptimizeModeLabel(promptOptimizeMode, t)}`}
          >
            {isOptimizingPrompt ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={16} />}
          </button>
          <button
            onClick={() => setShowPromptOptimizeMenu((open) => !open)}
            disabled={isOptimizingPrompt || isPreparingPrompt}
            className={cn(
              'flex h-10 w-7 items-center justify-center rounded-r-xl border transition-colors',
              promptOptimizeMode !== 'auto' || showPromptOptimizeMenu
                ? 'border-pi-accent/25 bg-pi-accent/10 text-pi-accent hover:bg-pi-accent/15'
                : 'border-pi-accent/20 bg-pi-accent/5 text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text',
              (isOptimizingPrompt || isPreparingPrompt) && 'cursor-not-allowed opacity-60'
            )}
            title={t('chat.optimizePromptModeMenu')}
          >
            <ChevronDown size={13} />
          </button>

          {showPromptOptimizeMenu && (
            <div className="pi-glass-menu absolute bottom-full left-0 z-[95] mb-2 w-[min(300px,calc(100vw-32px))] overflow-hidden rounded-lg">
              <div className="border-b border-pi-border/70 px-3 py-2 text-[10px] font-semibold uppercase text-pi-dim">
                {t('chat.optimizePromptModeMenu')}
              </div>
              <div className="max-h-[340px] overflow-y-auto py-1">
                {PROMPT_OPTIMIZE_MODES.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setPromptOptimizeMode(mode);
                      setShowPromptOptimizeMenu(false);
                    }}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-pi-bg-hover',
                      promptOptimizeMode === mode ? 'bg-pi-selected-bg text-pi-text' : 'text-pi-muted'
                    )}
                  >
                    <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-pi-border/70 text-pi-accent">
                      {promptOptimizeMode === mode ? <Check size={10} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-pi-text">{promptOptimizeModeLabel(mode, t)}</span>
                      <span className="block text-[10px] leading-relaxed text-pi-dim">{promptOptimizeModeDescription(mode, t)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {lastPromptOptimization && text === lastPromptOptimization.optimizedText && (
          <button
            onClick={undoPromptOptimization}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-transparent text-pi-dim transition-colors hover:border-pi-accent/25 hover:bg-pi-bg-hover hover:text-pi-text"
            title={t('chat.optimizePromptUndo')}
          >
            <Undo2 size={15} />
          </button>
        )}

        <button
          onClick={() => void launchAgentRoom()}
          disabled={isPreparingPrompt}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-transparent text-pi-dim transition-colors hover:border-pi-accent/25 hover:bg-pi-accent/10 hover:text-pi-accent disabled:cursor-not-allowed disabled:opacity-50"
          title={t('agentsRoom.launchFromComposer')}
        >
          <Network size={16} />
        </button>

        <div className="flex-1 relative min-w-0">
          {showFileSearch && (
            <div className="pi-glass-menu absolute bottom-full left-0 right-0 z-[90] mb-2 overflow-hidden rounded-lg">
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

          <div
            className={cn(
              'pi-glass-control pi-composer-input-control flex min-h-[40px] w-full items-center overflow-visible rounded-xl transition-colors',
              showPromptOptimizeMenu && 'border-pi-accent/45'
            )}
          >
            <div ref={promptOptimizeMenuRef} className="relative ml-1 flex h-9 flex-shrink-0 items-center rounded-xl border border-pi-border/55 bg-pi-bg/45 p-0.5 shadow-[inset_0_1px_color-mix(in_srgb,white_8%,transparent)]">
              <button
                onClick={optimizeComposerPrompt}
                disabled={!text.trim() || isOptimizingPrompt || isPreparingPrompt}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-[10px] transition-all duration-150',
                  text.trim() && !isOptimizingPrompt && !isPreparingPrompt
                    ? 'bg-pi-accent/10 text-pi-accent shadow-[inset_0_1px_color-mix(in_srgb,white_10%,transparent)] hover:bg-pi-accent/16 active:scale-95'
                    : 'cursor-not-allowed text-pi-dim opacity-60'
                )}
                title={`${t('chat.optimizePrompt')} · ${promptOptimizeModeLabel(promptOptimizeMode, t)}`}
              >
                {isOptimizingPrompt ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={15} />}
              </button>
              <button
                onClick={() => setShowPromptOptimizeMenu((open) => !open)}
                disabled={isOptimizingPrompt || isPreparingPrompt}
                className={cn(
                  'flex h-8 w-6 items-center justify-center rounded-[10px] transition-all duration-150',
                  promptOptimizeMode !== 'auto' || showPromptOptimizeMenu
                    ? 'bg-pi-accent/10 text-pi-accent shadow-[inset_0_1px_color-mix(in_srgb,white_10%,transparent)] hover:bg-pi-accent/16 active:scale-95'
                    : 'text-pi-dim hover:bg-pi-bg-hover/80 hover:text-pi-text active:scale-95',
                  (isOptimizingPrompt || isPreparingPrompt) && 'cursor-not-allowed opacity-60'
                )}
                title={t('chat.optimizePromptModeMenu')}
              >
                <ChevronDown size={12} />
              </button>

              {showPromptOptimizeMenu && (
                <div className="pi-glass-menu absolute bottom-full left-0 z-[95] mb-2 w-[min(300px,calc(100vw-32px))] overflow-hidden rounded-lg">
                  <div className="border-b border-pi-border/70 px-3 py-2 text-[10px] font-semibold uppercase text-pi-dim">
                    {t('chat.optimizePromptModeMenu')}
                  </div>
                  <div className="max-h-[340px] overflow-y-auto py-1">
                    {PROMPT_OPTIMIZE_MODES.map((mode) => (
                      <button
                        key={mode}
                        onClick={() => {
                          setPromptOptimizeMode(mode);
                          setShowPromptOptimizeMenu(false);
                        }}
                        className={cn(
                          'flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-pi-bg-hover',
                          promptOptimizeMode === mode ? 'bg-pi-selected-bg text-pi-text' : 'text-pi-muted'
                        )}
                      >
                        <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-pi-border/70 text-pi-accent">
                          {promptOptimizeMode === mode ? <Check size={10} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-pi-text">{promptOptimizeModeLabel(mode, t)}</span>
                          <span className="block text-[10px] leading-relaxed text-pi-dim">{promptOptimizeModeDescription(mode, t)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={() => { composingRef.current = false; }}
              onPaste={handlePaste}
              placeholder={isStreaming
                ? t(streamingSendMode === 'steer' ? 'chat.steerPlaceholder' : 'chat.queuePlaceholder')
                : t('chat.messagePlaceholder')}
              rows={1}
              className="pi-embedded-input min-h-[40px] max-h-[200px] flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-6 text-pi-text placeholder-pi-dim transition-colors focus:outline-none"
              style={{ fontFamily: 'inherit' }}
            />

            {isStreaming && (
              <StreamingQueueModeControl
                mode={streamingSendMode}
                steeringCount={queueCounts.steering}
                followUpCount={queueCounts.followUp + queuedFollowUps.length}
                onChange={setStreamingSendMode}
              />
            )}

            {(!isStreaming || canSubmit) && (
              <button
                onClick={() => void handleSend()}
                disabled={!canSubmit || isPreparingPrompt}
                className={cn(
                  'mr-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border transition-all duration-150 shadow-[inset_0_1px_color-mix(in_srgb,white_16%,transparent),0_2px_8px_color-mix(in_srgb,black_18%,transparent)]',
                  canSubmit && !isPreparingPrompt
                    ? 'border-pi-accent/35 bg-pi-accent/88 text-white hover:bg-pi-accent active:scale-95'
                    : 'cursor-not-allowed border-pi-border/55 bg-pi-bg-tertiary/70 text-pi-dim shadow-[inset_0_1px_color-mix(in_srgb,white_8%,transparent)]'
                )}
                title={isStreaming
                  ? t(streamingSendMode === 'steer' ? 'chat.steerCurrent' : 'chat.queueFollowUp')
                  : t('chat.sendMessage')}
              >
                {isPreparingPrompt ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            )}
          </div>
        </div>

        {isStreaming && (
          <button
            onClick={onStop}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-pi-error/20 text-pi-error transition-colors hover:bg-pi-error/30"
            title={t('chat.stopGeneration')}
          >
            <Square size={14} fill="currentColor" />
          </button>
        )}
      </div>
    </div>
  );
}

function StreamingQueueModeControl({
  mode,
  steeringCount,
  followUpCount,
  onChange,
}: {
  mode: StreamingSendMode;
  steeringCount: number;
  followUpCount: number;
  onChange: (mode: StreamingSendMode) => void;
}) {
  const { t } = useI18n();

  return (
    <div
      className="mr-1 flex flex-shrink-0 items-center rounded-lg border border-pi-border/60 bg-pi-bg/40 p-0.5 shadow-inner"
      title={t('chat.queueModeHint')}
    >
      <button
        type="button"
        onClick={() => onChange('steer')}
        className={cn(
          'flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
          mode === 'steer'
            ? 'bg-pi-accent/14 text-pi-accent shadow-sm'
            : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
        )}
        title={t('chat.steerCurrentHint')}
      >
        <Command size={12} />
        <span>{t('chat.queueModeSteer')}</span>
        {steeringCount > 0 && (
          <span className="ml-0.5 rounded-full bg-pi-accent/15 px-1.5 text-[10px] text-pi-accent">
            {steeringCount}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onChange('follow_up')}
        className={cn(
          'flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
          mode === 'follow_up'
            ? 'bg-pi-accent/14 text-pi-accent shadow-sm'
            : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
        )}
        title={t('chat.queueFollowUpHint')}
      >
        <Send size={12} />
        <span>{t('chat.queueModeFollowUp')}</span>
        {followUpCount > 0 && (
          <span className="ml-0.5 rounded-full bg-pi-accent/15 px-1.5 text-[10px] text-pi-accent">
            {followUpCount}
          </span>
        )}
      </button>
    </div>
  );
}

function QueuedFollowUpCards({
  items,
  onEdit,
  onDelete,
  onGuide,
}: {
  items: QueuedFollowUpItem[];
  onEdit: (item: QueuedFollowUpItem) => void;
  onDelete: (id: string) => void;
  onGuide: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="px-3 pb-2">
      <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
        {items.map((item, index) => {
          const preview = queuedFollowUpPreview(item);
          const referenceCount = item.draft?.fileReferences.length ?? 0;
          const imageCount = item.draft?.attachments.length ?? item.images?.length ?? 0;

          return (
            <div
              key={item.id}
              className="group flex items-start gap-2 rounded-xl border border-pi-accent/20 bg-pi-accent/10 px-2.5 py-2 shadow-sm backdrop-blur-xl"
            >
              <div className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-pi-accent/14 text-[10px] font-semibold text-pi-accent">
                {index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11px] font-semibold text-pi-accent">{t('chat.queuedFollowUpLabel')}</span>
                  <span className="text-[10px] text-pi-dim">{t('chat.queuedFollowUpStatus')}</span>
                  {referenceCount > 0 && (
                    <span className="rounded-full border border-pi-border/60 px-1.5 py-0.5 text-[10px] text-pi-dim">
                      {t('chat.queuedFollowUpReferences', { count: referenceCount })}
                    </span>
                  )}
                  {imageCount > 0 && (
                    <span className="rounded-full border border-pi-border/60 px-1.5 py-0.5 text-[10px] text-pi-dim">
                      {t('chat.queuedFollowUpImages', { count: imageCount })}
                    </span>
                  )}
                </div>
                <div className="mt-1 max-h-10 overflow-hidden whitespace-pre-wrap break-words text-xs leading-5 text-pi-text">
                  {preview || item.displayText}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1 opacity-90 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => onEdit(item)}
                  className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                  title={t('chat.queuedFollowUpEdit')}
                >
                  <Pencil size={12} />
                  <span className="hidden sm:inline">{t('chat.queuedFollowUpEdit')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onGuide(item.id)}
                  className="flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-pi-dim transition-colors hover:bg-pi-accent/12 hover:text-pi-accent"
                  title={t('chat.queuedFollowUpGuide')}
                >
                  <Command size={12} />
                  <span className="hidden sm:inline">{t('chat.queuedFollowUpGuide')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  className="flex h-7 items-center justify-center rounded-lg px-2 text-pi-dim transition-colors hover:bg-pi-error/12 hover:text-pi-error"
                  title={t('chat.queuedFollowUpDelete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function queuedFollowUpPreview(item: QueuedFollowUpItem): string {
  if (item.draft?.text.trim()) return item.draft.text.trim();
  return item.displayText
    .split('\n')
    .filter((line) => !line.trim().startsWith('@'))
    .join('\n')
    .trim() || item.displayText.trim() || item.text.trim();
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
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const node = refEl.current;
    if (!node) return;

    const updateCompact = () => {
      setCompact(node.clientWidth < 520);
    };

    updateCompact();

    const observer = new ResizeObserver(updateCompact);
    observer.observe(node);
    window.addEventListener('resize', updateCompact);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateCompact);
    };
  }, [refEl]);

  return (
    <div ref={refEl} className="relative z-[70] flex min-w-0 items-center gap-1.5 px-3 pt-2">
      <ComposerControlButton
        icon={<Bot size={12} />}
        label={currentModel?.name ?? t('chat.noModel')}
        active={openMenu === 'model'}
        compact={compact}
        title={t('chat.modelTitle')}
        onClick={() => onToggleMenu('model')}
      />
      <ComposerControlButton
        icon={<Shield size={12} />}
        label={permissionModeLabel(selectedPermission, t)}
        active={openMenu === 'permission'}
        compact={compact}
        tone={permissionMode === 'bypassPermissions' ? 'warning' : undefined}
        title={t('chat.permissionMode')}
        onClick={() => onToggleMenu('permission')}
      />
      <ComposerControlButton
        icon={<Brain size={12} />}
        label={thinkingLevelLabel(thinkingLevel, t)}
        active={openMenu === 'thinking'}
        compact={compact}
        className={thinkingLevelPillClass(thinkingLevel, openMenu === 'thinking')}
        title={t('chat.thinkingLevel')}
        onClick={() => onToggleMenu('thinking')}
      />
      {activeSession && <WorkspaceSwitcher activeSession={activeSession} placement="toolbar" compact={compact} />}
      <button
        onClick={onOpenUsage}
        className={cn(
          'flex h-7 min-w-0 flex-shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] transition-colors',
          compact ? 'max-w-[76px]' : 'max-w-[190px]',
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
        <div className="pi-glass-menu absolute bottom-full left-3 z-[90] mb-2 w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-lg">
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
        <div className="pi-glass-menu absolute bottom-full left-3 z-[90] mb-2 w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-lg">
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
        <div className="pi-glass-menu absolute bottom-full left-3 z-[90] mb-2 w-[min(260px,calc(100vw-32px))] overflow-hidden rounded-lg">
          <div className="border-b border-pi-border/70 px-3 py-2 text-[10px] font-semibold uppercase text-pi-dim">{t('chat.thinkingTitle')}</div>
          <div className="grid grid-cols-2 gap-1 p-2">
            {THINKING_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => onSelectThinking(level)}
                className={cn(
                  'h-8 rounded-md border px-2 text-xs capitalize transition-colors',
                  thinkingLevel === level
                    ? thinkingLevelPillClass(level, true)
                    : cn('border-transparent bg-transparent hover:bg-pi-bg-hover', thinkingLevelTextClass(level))
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
  compact,
  className,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  tone?: 'warning';
  compact?: boolean;
  className?: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={title}
      className={cn(
        'flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 text-[11px] transition-colors',
        compact ? 'w-7 flex-shrink-0 px-0' : 'max-w-[180px]',
        active
          ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent'
          : tone === 'warning'
            ? 'border-pi-warning/40 bg-pi-warning/10 text-pi-warning hover:bg-pi-warning/15'
            : 'border-pi-border/70 bg-pi-bg-secondary/70 text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text',
        className
      )}
      title={title}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!compact && <span className="truncate">{label}</span>}
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

function sameWorkspaceRoot(a: string, b: string): boolean {
  return normalizeComparablePath(a) === normalizeComparablePath(b);
}

function normalizeComparablePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/g, '');
  return isWindowsLikePath(normalized) ? normalized.toLowerCase() : normalized;
}

function isWindowsLikePath(value: string): boolean {
  return /^[a-zA-Z]:\//.test(value) || value.startsWith('//');
}

function readPlainDroppedPath(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes('text/plain')) return null;
  if (dataTransfer.files.length > 0) return null;

  const value = dataTransfer.getData('text/plain').trim();
  if (!looksLikeWorkspacePath(value)) return null;
  return value.replace(/^file:\/\//i, '').trim();
}

function looksLikeWorkspacePath(value: string): boolean {
  if (!value || /[\r\n]/.test(value)) return false;
  if (/^[a-z]+:\/\//i.test(value) && !/^file:\/\//i.test(value)) return false;
  const normalized = value.replace(/^file:\/\//i, '').replace(/\\/g, '/');
  const name = basename(normalized);
  return normalized.includes('/') || /^[\w .@()[\]-]+\.[a-zA-Z0-9]{1,12}$/.test(name);
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

function referenceDirectoryLabel(value: string): string {
  const normalized = normalizeWorkspacePath(value);
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/') || normalized;
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
  const merged = [...fallbackCommands, ...commands];
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
    if (part.type === 'image') return total + Math.ceil((part.image?.data.length ?? 0) * 0.75);
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

function detectPromptLanguage(input: string): 'zh' | 'en' | 'ja' {
  if (/[\u3040-\u30ff]/.test(input)) return 'ja';
  return /[\u3400-\u9fff]/.test(input) ? 'zh' : 'en';
}

function promptOptimizeModeLabel(
  mode: PromptOptimizeMode,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  return t(`chat.optimizePromptMode.${mode}.label` as TranslationKey);
}

function promptOptimizeModeDescription(
  mode: PromptOptimizeMode,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  return t(`chat.optimizePromptMode.${mode}.description` as TranslationKey);
}

function promptOptimizeSourceLabel(
  result: PromptOptimizeResult,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  if (result.source === 'skill') {
    return t('chat.optimizePromptSourceSkill', { skill: result.skillName ?? 'skill' });
  }
  if (result.source === 'model') {
    const model = [result.provider, result.modelId].filter(Boolean).join('/');
    return model ? t('chat.optimizePromptSourceModelNamed', { model }) : t('chat.optimizePromptSourceModel');
  }
  return t('chat.optimizePromptSourceLocal');
}

function promptOptimizationRiskLabel(
  risk: NonNullable<PromptOptimizeResult['changedIntentRisk']>,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  return t(`chat.optimizePromptRisk.${risk}` as TranslationKey);
}

function promptOptimizationRiskClass(risk: NonNullable<PromptOptimizeResult['changedIntentRisk']>): string {
  if (risk === 'high') return 'border-pi-error/35 bg-pi-error/10 text-pi-error';
  if (risk === 'medium') return 'border-pi-warning/35 bg-pi-warning/10 text-pi-warning';
  return 'border-pi-success/30 bg-pi-success/10 text-pi-success';
}

function buildPromptFileReferences(references: WorkspaceFileReference[]): PromptOptimizeFileReference[] | undefined {
  if (references.length === 0) return undefined;
  return references.slice(0, 12).map((reference) => ({
    path: reference.path,
    name: reference.name,
    lineStart: reference.lineStart,
    lineEnd: reference.lineEnd,
    excerpt: reference.excerpt ? truncateInline(reference.excerpt, 1600) : undefined,
  }));
}

function buildPromptImageReferences(attachments: ImageAttachment[]): PromptOptimizeImageReference[] | undefined {
  if (attachments.length === 0) return undefined;
  return attachments.slice(0, 6).map((attachment, index) => ({
    fileName: attachment.fileName ?? `image-${index + 1}`,
    mimeType: attachment.mimeType,
  }));
}

function buildPromptSessionContext(
  activeSession: Session | undefined,
  messages: ChatMessage[]
): PromptOptimizeSessionContext | undefined {
  const recent = [...messages].reverse();
  const lastUserMessage = recent.find((message) => message.role === 'user');
  const lastAssistantMessage = recent.find((message) => message.role === 'assistant');
  const context: PromptOptimizeSessionContext = {
    title: activeSession?.title,
    lastUserMessage: lastUserMessage ? truncateInline(messagePlainText(lastUserMessage), 900) : undefined,
    lastAssistantSummary: lastAssistantMessage ? truncateInline(messagePlainText(lastAssistantMessage), 900) : undefined,
  };
  return context.title || context.lastUserMessage || context.lastAssistantSummary ? context : undefined;
}

async function collectPromptWorkspaceContext(sessionId: string): Promise<PromptOptimizeWorkspaceContext | undefined> {
  try {
    const status = await piApi.getWorkspaceStatus(sessionId);
    if (status.state !== 'ok' && status.state !== 'not_git_repo') return undefined;
    const changedFiles = status.changedFiles.slice(0, 30).map((file) => ({
      path: file.path,
      status: [
        file.staged ? 'staged' : '',
        file.unstaged ? 'unstaged' : '',
        file.status,
      ].filter(Boolean).join(' '),
    }));
    return {
      branch: status.branch ?? undefined,
      dirty: Boolean(status.hasStagedChanges || status.hasUnstagedChanges || changedFiles.length > 0),
      changedFiles: changedFiles.length > 0 ? changedFiles : undefined,
    };
  } catch {
    return undefined;
  }
}

function messagePlainText(message: ChatMessage): string {
  const parts = message.content.map((part) => {
    if (part.type === 'text') return part.text ?? '';
    if (part.type === 'thinking') return part.thinking?.content ?? '';
    if (part.type === 'tool_result') return part.toolResult?.content ?? '';
    if (part.type === 'image') return `[image:${part.image?.fileName ?? part.image?.mimeType ?? 'attached'}]`;
    if (part.type === 'tool_use') return `[tool:${part.toolUse?.name ?? 'unknown'}]`;
    return '';
  });
  return parts.join('\n').trim();
}

function truncateInline(value: string, maxLength: number): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
