export interface TextSelectionReference {
  excerpt: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface WorkspaceReferenceDetail extends TextSelectionReference {
  sessionId: string;
  path: string;
  name?: string;
  sourceKind?: 'file' | 'diff';
}

const WORKSPACE_REFERENCE_EVENT = 'pi:add-workspace-reference';

export function workspaceBasename(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

export function textSelectionFromTextArea(input: HTMLTextAreaElement): TextSelectionReference | null {
  const start = Math.min(input.selectionStart, input.selectionEnd);
  const end = Math.max(input.selectionStart, input.selectionEnd);
  if (start === end) return null;

  const rawExcerpt = input.value.slice(start, end);
  const excerpt = normalizeSelectionText(rawExcerpt);
  if (!excerpt.trim()) return null;

  return {
    excerpt,
    lineStart: lineNumberAtOffset(input.value, start),
    lineEnd: lineNumberAtOffset(input.value, Math.max(start, end - 1)),
  };
}

export function textSelectionFromDocument(content: string, root: HTMLElement): TextSelectionReference | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  if (!selection.anchorNode || !selection.focusNode) return null;
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;

  const excerpt = normalizeSelectionText(selection.toString());
  if (!excerpt.trim()) return null;

  return {
    excerpt,
    ...locateSelectionInContent(content, excerpt),
  };
}

export function addWorkspaceReferenceToChat(detail: WorkspaceReferenceDetail): void {
  const payload: WorkspaceReferenceDetail = {
    ...detail,
    name: detail.name || workspaceBasename(detail.path),
  };

  if (isDetachedDesktopView()) {
    void window.piDesktop?.addWorkspaceReference(payload).catch(() => undefined);
    return;
  }

  window.dispatchEvent(new CustomEvent(WORKSPACE_REFERENCE_EVENT, { detail: payload }));
}

export function formatSelectionLineRange(selection: TextSelectionReference): string | null {
  if (!selection.lineStart || !selection.lineEnd) return null;
  return selection.lineStart === selection.lineEnd
    ? `L${selection.lineStart}`
    : `L${selection.lineStart}-L${selection.lineEnd}`;
}

function locateSelectionInContent(content: string, excerpt: string): Pick<TextSelectionReference, 'lineStart' | 'lineEnd'> {
  const normalizedContent = normalizeNewlines(content);
  const normalizedExcerpt = normalizeNewlines(excerpt);
  const exactIndex = normalizedContent.indexOf(normalizedExcerpt);
  if (exactIndex >= 0) {
    return lineRangeForOffsets(normalizedContent, exactIndex, exactIndex + normalizedExcerpt.length);
  }

  const collapsedContent = buildCollapsedIndexMap(normalizedContent);
  const collapsedExcerpt = buildCollapsedIndexMap(normalizedExcerpt);
  if (!collapsedExcerpt.text) return {};

  const collapsedIndex = collapsedContent.text.indexOf(collapsedExcerpt.text);
  if (collapsedIndex < 0) return {};

  const rawStart = collapsedContent.offsets[collapsedIndex];
  const rawEndOffset = collapsedContent.offsets[collapsedIndex + collapsedExcerpt.text.length - 1];
  if (!Number.isInteger(rawStart) || !Number.isInteger(rawEndOffset)) return {};
  return lineRangeForOffsets(normalizedContent, rawStart, rawEndOffset + 1);
}

function lineRangeForOffsets(content: string, start: number, end: number): Pick<TextSelectionReference, 'lineStart' | 'lineEnd'> {
  return {
    lineStart: lineNumberAtOffset(content, start),
    lineEnd: lineNumberAtOffset(content, Math.max(start, end - 1)),
  };
}

function lineNumberAtOffset(content: string, offset: number): number {
  const safeOffset = Math.max(0, Math.min(content.length, offset));
  let line = 1;
  for (let index = 0; index < safeOffset; index += 1) {
    if (content.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function normalizeSelectionText(value: string): string {
  return normalizeNewlines(value).replace(/\u00a0/g, ' ').trim();
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function buildCollapsedIndexMap(value: string): { text: string; offsets: number[] } {
  const text: string[] = [];
  const offsets: number[] = [];
  let pendingWhitespaceOffset: number | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (/\s/.test(char)) {
      if (pendingWhitespaceOffset === null) pendingWhitespaceOffset = index;
      continue;
    }

    if (pendingWhitespaceOffset !== null && text.length > 0) {
      text.push(' ');
      offsets.push(pendingWhitespaceOffset);
    }

    pendingWhitespaceOffset = null;
    text.push(char);
    offsets.push(index);
  }

  return { text: text.join(''), offsets };
}

function isDetachedDesktopView(): boolean {
  if (typeof window === 'undefined') return false;
  const desktopView = new URLSearchParams(window.location.search).get('desktopView');
  return desktopView === 'markdown' || desktopView === 'workspace-file' || desktopView === 'standalone-tabs';
}
