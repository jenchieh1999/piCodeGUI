export interface TextSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface TextSearchMatch {
  start: number;
  end: number;
}

export interface TextSearchState {
  query: string;
  replacement: string;
  options: TextSearchOptions;
  matches: TextSearchMatch[];
  currentIndex: number;
  error: string | null;
}

export const DEFAULT_TEXT_SEARCH_OPTIONS: TextSearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export function findTextMatches(text: string, query: string, options: TextSearchOptions): { matches: TextSearchMatch[]; error: string | null } {
  if (!query) return { matches: [], error: null };

  const pattern = createSearchRegExp(query, options, true);
  if (pattern instanceof Error) return { matches: [], error: pattern.message };

  const matches: TextSearchMatch[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const value = match[0] ?? '';
    if (!value) {
      pattern.lastIndex = start + 1;
      continue;
    }
    matches.push({ start, end: start + value.length });
  }

  return { matches, error: null };
}

export function replaceTextMatch(
  text: string,
  match: TextSearchMatch,
  query: string,
  replacement: string,
  options: TextSearchOptions
): string {
  const current = text.slice(match.start, match.end);
  const next = options.regex
    ? current.replace(createSearchRegExpForReplace(query, options), replacement)
    : replacement;
  return `${text.slice(0, match.start)}${next}${text.slice(match.end)}`;
}

export function replaceAllTextMatches(
  text: string,
  query: string,
  replacement: string,
  options: TextSearchOptions
): { text: string; count: number; error: string | null } {
  const { matches, error } = findTextMatches(text, query, options);
  if (error) return { text, count: 0, error };
  if (matches.length === 0) return { text, count: 0, error: null };

  if (options.regex) {
    const pattern = createSearchRegExp(query, options, true);
    if (pattern instanceof Error) return { text, count: 0, error: pattern.message };
    return { text: text.replace(pattern, replacement), count: matches.length, error: null };
  }

  let next = text;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    next = `${next.slice(0, match.start)}${replacement}${next.slice(match.end)}`;
  }
  return { text: next, count: matches.length, error: null };
}

export function createSearchRegExp(query: string, options: TextSearchOptions, global: boolean): RegExp | Error {
  try {
    const source = options.regex ? query : escapeRegExp(query);
    const wordSource = options.wholeWord ? `\\b(?:${source})\\b` : source;
    return new RegExp(wordSource, `${global ? 'g' : ''}${options.caseSensitive ? '' : 'i'}`);
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

export function applyDomSearchHighlights(
  root: HTMLElement | null,
  query: string,
  options: TextSearchOptions,
  currentIndex: number
): number {
  if (!root) return 0;
  clearDomSearchHighlights(root);
  if (!query) return 0;

  const pattern = createSearchRegExp(query, options, true);
  if (pattern instanceof Error) return 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (parent.closest('mark[data-pi-search-highlight], input, textarea, script, style')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }

  let index = 0;
  let currentMark: HTMLElement | null = null;

  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    const matches = [...value.matchAll(pattern)].filter((match) => match[0]);
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      const start = match.index ?? 0;
      const text = match[0] ?? '';
      if (start > cursor) {
        fragment.append(document.createTextNode(value.slice(cursor, start)));
      }

      const mark = document.createElement('mark');
      mark.dataset.piSearchHighlight = 'true';
      mark.className = index === currentIndex
        ? 'pi-search-highlight pi-search-highlight-current'
        : 'pi-search-highlight';
      mark.textContent = text;
      fragment.append(mark);
      if (index === currentIndex) currentMark = mark;
      index += 1;
      cursor = start + text.length;
    }

    if (cursor < value.length) {
      fragment.append(document.createTextNode(value.slice(cursor)));
    }
    node.replaceWith(fragment);
  }

  if (currentMark) {
    window.requestAnimationFrame(() => {
      currentMark?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  }

  return index;
}

export function clearDomSearchHighlights(root: HTMLElement | null) {
  if (!root) return;
  const marks = [...root.querySelectorAll('mark[data-pi-search-highlight]')];
  for (const mark of marks) {
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
  }
  root.normalize();
}

function createSearchRegExpForReplace(query: string, options: TextSearchOptions): RegExp {
  const pattern = createSearchRegExp(query, options, false);
  if (pattern instanceof Error) return /$^/;
  return pattern;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
