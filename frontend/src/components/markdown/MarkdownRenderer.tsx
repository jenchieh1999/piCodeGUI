import { useMemo, useState, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { createHighlighter, type Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['dark-plus'],
      langs: [
        'typescript', 'javascript', 'python', 'rust', 'go', 'java',
        'c', 'cpp', 'csharp', 'html', 'css', 'json', 'yaml', 'xml',
        'markdown', 'sql', 'bash', 'shell', 'sh', 'zsh',
        'jsx', 'tsx', 'vue', 'svelte', 'astro',
        'ruby', 'php', 'swift', 'kotlin', 'scala',
        'dockerfile', 'toml', 'ini', 'diff', 'graphql',
        'lua', 'perl', 'r', 'dart',
      ],
    });
  }
  return highlighterPromise;
}

// Configure marked with custom code renderer
const renderer = new marked.Renderer();
renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
  // Return a placeholder that we'll replace after async highlighting
  const id = `code-${Math.random().toString(36).slice(2)}`;
  codeBlocks.set(id, { text, lang: lang ?? '' });
  return `<pre><code data-code-id="${id}">${escapeHtml(text)}</code></pre>`;
};

marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
});

const codeBlocks = new Map<string, { text: string; lang: string }>();

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const [html, setHtml] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        codeBlocks.clear();
        
        const rawHtml = await marked.parse(content, { async: true });
        
        if (cancelled) return;
        
        // Post-process code blocks with shiki highlighting
        const highlighter = await getHighlighter();
        let result = rawHtml;
        
        for (const [id, { text: codeText, lang }] of codeBlocks) {
          let highlighted: string;
          if (lang && highlighter.getLoadedLanguages().includes(lang)) {
            try {
              highlighted = highlighter.codeToHtml(codeText, { lang, theme: 'dark-plus' });
            } catch {
              highlighted = `<pre><code>${escapeHtml(codeText)}</code></pre>`;
            }
          } else {
            highlighted = `<pre><code>${escapeHtml(codeText)}</code></pre>`;
          }
          result = result.replace(
            `<pre><code data-code-id="${id}">${escapeHtml(codeText)}</code></pre>`,
            highlighted
          );
        }

        if (!cancelled) {
          const clean = DOMPurify.sanitize(result, {
            USE_PROFILES: { html: true },
            ADD_ATTR: ['target'],
          });
          setHtml(clean);
        }
      } catch {
        if (!cancelled) {
          // Fallback: plain text with escaping
          const clean = DOMPurify.sanitize(escapeHtml(content), { ALLOWED_TAGS: [] });
          setHtml(`<pre>${clean}</pre>`);
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [content]);

  return (
    <div
      className="markdown-body text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
