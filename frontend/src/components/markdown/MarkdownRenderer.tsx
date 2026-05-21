import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { HighlighterCore, LanguageInput, ThemeInput } from 'shiki/core';

type LanguageId =
  | 'typescript'
  | 'javascript'
  | 'tsx'
  | 'jsx'
  | 'json'
  | 'jsonc'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'c'
  | 'csharp'
  | 'html'
  | 'css'
  | 'yaml'
  | 'xml'
  | 'markdown'
  | 'sql'
  | 'bash'
  | 'shellscript'
  | 'vue'
  | 'svelte'
  | 'astro'
  | 'php'
  | 'swift'
  | 'kotlin'
  | 'scala'
  | 'docker'
  | 'toml'
  | 'ini'
  | 'diff'
  | 'graphql'
  | 'lua'
  | 'perl'
  | 'r'
  | 'dart';

type LanguageModule = { default: LanguageInput };
type LanguageLoader = () => Promise<LanguageModule>;

const languageLoaders: Record<LanguageId, LanguageLoader> = {
  typescript: () => import('shiki/langs/typescript.mjs') as Promise<LanguageModule>,
  javascript: () => import('shiki/langs/javascript.mjs') as Promise<LanguageModule>,
  tsx: () => import('shiki/langs/tsx.mjs') as Promise<LanguageModule>,
  jsx: () => import('shiki/langs/jsx.mjs') as Promise<LanguageModule>,
  json: () => import('shiki/langs/json.mjs') as Promise<LanguageModule>,
  jsonc: () => import('shiki/langs/jsonc.mjs') as Promise<LanguageModule>,
  python: () => import('shiki/langs/python.mjs') as Promise<LanguageModule>,
  rust: () => import('shiki/langs/rust.mjs') as Promise<LanguageModule>,
  go: () => import('shiki/langs/go.mjs') as Promise<LanguageModule>,
  java: () => import('shiki/langs/java.mjs') as Promise<LanguageModule>,
  c: () => import('shiki/langs/c.mjs') as Promise<LanguageModule>,
  csharp: () => import('shiki/langs/csharp.mjs') as Promise<LanguageModule>,
  html: () => import('shiki/langs/html.mjs') as Promise<LanguageModule>,
  css: () => import('shiki/langs/css.mjs') as Promise<LanguageModule>,
  yaml: () => import('shiki/langs/yaml.mjs') as Promise<LanguageModule>,
  xml: () => import('shiki/langs/xml.mjs') as Promise<LanguageModule>,
  markdown: () => import('shiki/langs/markdown.mjs') as Promise<LanguageModule>,
  sql: () => import('shiki/langs/sql.mjs') as Promise<LanguageModule>,
  bash: () => import('shiki/langs/bash.mjs') as Promise<LanguageModule>,
  shellscript: () => import('shiki/langs/shellscript.mjs') as Promise<LanguageModule>,
  vue: () => import('shiki/langs/vue.mjs') as Promise<LanguageModule>,
  svelte: () => import('shiki/langs/svelte.mjs') as Promise<LanguageModule>,
  astro: () => import('shiki/langs/astro.mjs') as Promise<LanguageModule>,
  php: () => import('shiki/langs/php.mjs') as Promise<LanguageModule>,
  swift: () => import('shiki/langs/swift.mjs') as Promise<LanguageModule>,
  kotlin: () => import('shiki/langs/kotlin.mjs') as Promise<LanguageModule>,
  scala: () => import('shiki/langs/scala.mjs') as Promise<LanguageModule>,
  docker: () => import('shiki/langs/docker.mjs') as Promise<LanguageModule>,
  toml: () => import('shiki/langs/toml.mjs') as Promise<LanguageModule>,
  ini: () => import('shiki/langs/ini.mjs') as Promise<LanguageModule>,
  diff: () => import('shiki/langs/diff.mjs') as Promise<LanguageModule>,
  graphql: () => import('shiki/langs/graphql.mjs') as Promise<LanguageModule>,
  lua: () => import('shiki/langs/lua.mjs') as Promise<LanguageModule>,
  perl: () => import('shiki/langs/perl.mjs') as Promise<LanguageModule>,
  r: () => import('shiki/langs/r.mjs') as Promise<LanguageModule>,
  dart: () => import('shiki/langs/dart.mjs') as Promise<LanguageModule>,
};

const languageAliases: Record<string, LanguageId> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  rs: 'rust',
  golang: 'go',
  cs: 'csharp',
  shell: 'bash',
  sh: 'bash',
  zsh: 'bash',
  powershell: 'shellscript',
  ps1: 'shellscript',
  yml: 'yaml',
  md: 'markdown',
  dockerfile: 'docker',
  gql: 'graphql',
};

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<LanguageId>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/dark-plus.mjs') as Promise<{ default: ThemeInput }>,
    ]).then(([core, engine, darkPlus]) => core.createHighlighterCore({
      themes: [darkPlus.default],
      langs: [],
      langAlias: languageAliases,
      engine: engine.createJavaScriptRegexEngine(),
      warnings: false,
    }));
  }
  return highlighterPromise;
}

async function ensureLanguage(highlighter: HighlighterCore, lang: LanguageId): Promise<boolean> {
  if (loadedLanguages.has(lang)) return true;

  try {
    const module = await languageLoaders[lang]();
    await highlighter.loadLanguage(module.default);
    loadedLanguages.add(lang);
    return true;
  } catch {
    return false;
  }
}

function normalizeLanguage(lang: string): LanguageId | null {
  const token = lang
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
    .split(/[\s,{:]/, 1)[0];

  if (!token) return null;
  if (token in languageLoaders) return token as LanguageId;
  return languageAliases[token] ?? null;
}

export async function highlightCodeToHtml(codeText: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  const normalizedLang = normalizeLanguage(lang);
  if (normalizedLang && await ensureLanguage(highlighter, normalizedLang)) {
    try {
      return highlighter.codeToHtml(codeText, { lang: normalizedLang, theme: 'dark-plus' });
    } catch {
      return `<pre><code>${escapeHtml(codeText)}</code></pre>`;
    }
  }

  return `<pre><code>${escapeHtml(codeText)}</code></pre>`;
}

interface MarkdownRendererProps {
  content: string;
  onRendered?: () => void;
}

export function MarkdownRenderer({ content, onRendered }: MarkdownRendererProps) {
  const [html, setHtml] = useState('');
  const onRenderedRef = useRef(onRendered);

  useEffect(() => {
    onRenderedRef.current = onRendered;
  }, [onRendered]);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const codeBlocks = new Map<string, { text: string; lang: string }>();
        const renderer = new marked.Renderer();
        renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
          const id = `code-${Math.random().toString(36).slice(2)}`;
          codeBlocks.set(id, { text, lang: lang ?? '' });
          return `<pre><code data-code-id="${id}">${escapeHtml(text)}</code></pre>`;
        };
        
        const rawHtml = await marked.parse(content, {
          async: true,
          breaks: true,
          gfm: true,
          renderer,
        });
        
        if (cancelled) return;
        
        // Post-process code blocks with shiki highlighting.
        let result = rawHtml;
        
        for (const [id, { text: codeText, lang }] of codeBlocks) {
          const highlighted = await highlightCodeToHtml(codeText, lang);
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
          window.requestAnimationFrame(() => onRenderedRef.current?.());
        }
      } catch {
        if (!cancelled) {
          // Fallback: plain text with escaping
          const clean = DOMPurify.sanitize(escapeHtml(content), { ALLOWED_TAGS: [] });
          setHtml(`<pre>${clean}</pre>`);
          window.requestAnimationFrame(() => onRenderedRef.current?.());
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
