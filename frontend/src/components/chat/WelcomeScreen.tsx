import {
  Bug,
  FileText,
  GitBranch,
  Search,
  Send,
  Sparkles,
  TestTube,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '../../lib/i18n';

interface WelcomeScreenProps {
  projectName: string;
  modelName: string;
  onSend: (text: string) => boolean | void;
}

const QUICK_STARTS: Array<{ icon: LucideIcon; labelKey: TranslationKey; prompt: string }> = [
  { icon: Search, labelKey: 'welcome.quick.explore', prompt: 'Explain the structure of this project' },
  { icon: Sparkles, labelKey: 'welcome.quick.create', prompt: 'Create a new component for...' },
  { icon: Bug, labelKey: 'welcome.quick.debug', prompt: 'Find and fix bugs in...' },
  { icon: FileText, labelKey: 'welcome.quick.document', prompt: 'Generate documentation for...' },
  { icon: GitBranch, labelKey: 'welcome.quick.refactor', prompt: 'Refactor the code in...' },
  { icon: TestTube, labelKey: 'welcome.quick.test', prompt: 'Write unit tests for...' },
];

export function WelcomeScreen({ projectName, modelName, onSend }: WelcomeScreenProps) {
  const { t } = useI18n();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const prompt = input.trim();
    if (!prompt) return;
    if (onSend(prompt) !== false) {
      setInput('');
    }
  };

  const handleQuickStart = (prompt: string) => {
    onSend(prompt);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-y-auto bg-transparent">
      <div className="max-w-lg w-full px-4 py-8 text-center">
        <div className="mb-6">
          <div className="w-16 h-16 rounded-2xl bg-pi-accent/10 border border-pi-accent/20 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={28} className="text-pi-accent" />
          </div>
          <h1 className="text-xl font-display font-bold text-pi-text mb-1">
            Pi Agent
          </h1>
          <p className="text-sm text-pi-dim">
            {projectName} - {modelName}
          </p>
        </div>

        <div className="flex items-center gap-2 mb-6">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            placeholder={t('welcome.placeholder')}
            className="flex-1 h-10 px-4 bg-pi-bg-tertiary border border-pi-border rounded-xl
                       text-sm text-pi-text placeholder-pi-dim
                       focus:outline-none focus:border-pi-accent transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl bg-pi-accent text-white flex items-center justify-center
                       hover:bg-pi-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            title={t('welcome.send')}
          >
            <Send size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {QUICK_STARTS.map((qs) => {
            const Icon = qs.icon;
            return (
              <button
                key={qs.labelKey}
                onClick={() => handleQuickStart(qs.prompt)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-pi-border
                           hover:border-pi-accent/30 hover:bg-pi-bg-hover transition-all text-left group"
              >
                <Icon size={15} className="flex-shrink-0 text-pi-accent" />
                <div>
                  <div className="text-xs font-medium text-pi-text group-hover:text-pi-accent transition-colors">
                    {t(qs.labelKey)}
                  </div>
                  <div className="text-[10px] text-pi-dim truncate max-w-[140px]">
                    {qs.prompt}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
