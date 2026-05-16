import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { piApi } from '../../api/client';
import { ArrowLeft, Palette, Download, Upload } from 'lucide-react';
import { cn } from '../shared/utils';

export function ThemeEditor() {
  const themes = useExtensionStore((s) => s.themes);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const addToast = useUIStore((s) => s.addToast);

  // Hardcoded theme token categories for display
  const tokenCategories = [
    {
      name: 'Core UI',
      tokens: ['accent', 'border', 'borderAccent', 'borderMuted', 'success', 'error', 'warning', 'muted', 'dim', 'text', 'thinkingText'],
    },
    {
      name: 'Backgrounds & Content',
      tokens: ['selectedBg', 'userMessageBg', 'userMessageText', 'customMessageBg', 'customMessageText', 'customMessageLabel', 'toolPendingBg', 'toolSuccessBg', 'toolErrorBg', 'toolTitle', 'toolOutput'],
    },
    {
      name: 'Markdown',
      tokens: ['mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode', 'mdCodeBlock', 'mdCodeBlockBorder', 'mdQuote', 'mdQuoteBorder', 'mdHr', 'mdListBullet'],
    },
    {
      name: 'Syntax',
      tokens: ['syntaxComment', 'syntaxKeyword', 'syntaxFunction', 'syntaxVariable', 'syntaxString', 'syntaxNumber', 'syntaxType', 'syntaxOperator', 'syntaxPunctuation'],
    },
    {
      name: 'Thinking Levels',
      tokens: ['thinkingOff', 'thinkingMinimal', 'thinkingLow', 'thinkingMedium', 'thinkingHigh', 'thinkingXhigh'],
    },
  ];

  const activeThemeName = 'dark'; // TODO: from settings

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-pi-border">
        <button
          onClick={() => setActiveView('chat')}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-pi-bg-hover text-pi-dim hover:text-pi-text transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-sm font-display font-semibold text-pi-text">Theme Editor</h1>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover transition-colors border border-pi-border"
        >
          <Upload size={12} />
          Import
        </button>
        <button
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover transition-colors border border-pi-border"
        >
          <Download size={12} />
          Export
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Theme Swatches */}
        <div className="flex flex-wrap gap-2 mb-6">
          {themes.map((theme) => (
            <button
              key={theme.name}
              onClick={() => piApi.send({ type: 'theme_set', name: theme.name })}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                theme.name === activeThemeName
                  ? 'border-pi-accent bg-pi-accent/10 text-pi-accent'
                  : 'border-pi-border text-pi-muted hover:text-pi-text hover:border-pi-muted'
              )}
            >
              <Palette size={12} className="inline mr-1.5" />
              {theme.name}
            </button>
          ))}
          <button
            className="px-3 py-1.5 rounded-md text-xs font-medium border border-dashed border-pi-border text-pi-dim hover:text-pi-muted transition-colors"
          >
            + New Theme
          </button>
        </div>

        {/* Token Categories */}
        <div className="space-y-6">
          {tokenCategories.map((cat) => (
            <div key={cat.name}>
              <h3 className="text-[10px] font-semibold text-pi-dim uppercase tracking-wider mb-2">
                {cat.name}
              </h3>
              <div className="grid grid-cols-3 gap-1.5">
                {cat.tokens.map((token) => {
                  // Get color from CSS variables as fallback display
                  const color = getComputedStyle(document.documentElement)
                    .getPropertyValue(`--pi-${token.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`)
                    .trim() || '#888';
                  
                  return (
                    <div
                      key={token}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-pi-bg-tertiary border border-pi-border group hover:border-pi-accent/30 transition-colors cursor-pointer"
                    >
                      <div
                        className="w-4 h-4 rounded ring-1 ring-inset ring-white/10 flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-[10px] font-mono text-pi-dim truncate group-hover:text-pi-text transition-colors">
                        {token}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
