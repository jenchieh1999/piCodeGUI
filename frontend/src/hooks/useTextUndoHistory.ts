import { useCallback, useEffect, useRef, type RefObject } from 'react';

interface TextSnapshot {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface UseTextUndoHistoryOptions {
  value: string;
  setValue: (value: string) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 200;

export function useTextUndoHistory({
  value,
  setValue,
  inputRef,
  maxDepth = DEFAULT_MAX_DEPTH,
}: UseTextUndoHistoryOptions) {
  const valueRef = useRef(value);
  const undoStackRef = useRef<TextSnapshot[]>([]);
  const redoStackRef = useRef<TextSnapshot[]>([]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const currentSnapshot = useCallback((): TextSnapshot => {
    const input = inputRef?.current;
    const selectionStart = input?.selectionStart ?? valueRef.current.length;
    const selectionEnd = input?.selectionEnd ?? selectionStart;

    return {
      value: valueRef.current,
      selectionStart,
      selectionEnd,
    };
  }, [inputRef]);

  const scheduleSelection = useCallback((selectionStart: number, selectionEnd: number) => {
    window.requestAnimationFrame(() => {
      const input = inputRef?.current;
      if (!input) return;
      const max = input.value.length;
      input.focus();
      input.setSelectionRange(clamp(selectionStart, 0, max), clamp(selectionEnd, 0, max));
    });
  }, [inputRef]);

  const pushUndo = useCallback((snapshot: TextSnapshot) => {
    const stack = undoStackRef.current;
    const last = stack[stack.length - 1];
    if (
      last &&
      last.value === snapshot.value &&
      last.selectionStart === snapshot.selectionStart &&
      last.selectionEnd === snapshot.selectionEnd
    ) {
      return;
    }

    stack.push(snapshot);
    if (stack.length > maxDepth) {
      stack.splice(0, stack.length - maxDepth);
    }
  }, [maxDepth]);

  const applyChange = useCallback((nextValue: string, selection?: { start: number; end: number }) => {
    const current = currentSnapshot();
    if (current.value !== nextValue) {
      pushUndo(current);
      redoStackRef.current = [];
    }

    valueRef.current = nextValue;
    setValue(nextValue);
    if (selection) scheduleSelection(selection.start, selection.end);
  }, [currentSnapshot, pushUndo, scheduleSelection, setValue]);

  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return false;

    redoStackRef.current.push(currentSnapshot());
    valueRef.current = previous.value;
    setValue(previous.value);
    scheduleSelection(previous.selectionStart, previous.selectionEnd);
    return true;
  }, [currentSnapshot, scheduleSelection, setValue]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return false;

    pushUndo(currentSnapshot());
    valueRef.current = next.value;
    setValue(next.value);
    scheduleSelection(next.selectionStart, next.selectionEnd);
    return true;
  }, [currentSnapshot, pushUndo, scheduleSelection, setValue]);

  const resetHistory = useCallback((nextValue = valueRef.current) => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    valueRef.current = nextValue;
  }, []);

  return {
    applyChange,
    undo,
    redo,
    resetHistory,
  };
}

export function isUndoShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z';
}

export function isRedoShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key'>): boolean {
  return (event.ctrlKey || event.metaKey) && (
    event.key.toLowerCase() === 'y' ||
    (event.shiftKey && event.key.toLowerCase() === 'z')
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
