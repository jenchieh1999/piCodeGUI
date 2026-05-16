import { Send, Sparkles } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

interface WelcomeScreenProps {
  projectName: string;
  modelName: string;
  onSend: (text: string) => void;
}

const QUICK_STARTS = [
  { icon: '🔍', label: 'Explore', prompt: 'Explain the structure of this project' },
  { icon: '📝', label: 'Create', prompt: 'Create a new component for...' },
  { icon: '🐛', label: 'Debug', prompt: 'Find and fix bugs in...' },
  { icon: '📚', label: 'Document', prompt: 'Generate documentation for...' },
  { icon: '♻️', label: 'Refactor', prompt: 'Refactor the code in...' },
  { icon: '🧪', label: 'Test', prompt: 'Write unit tests for...' },
];

export function WelcomeScreen({ projectName, modelName, onSend }: WelcomeScreenProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  const handleQuickStart = (prompt: string) => {
    onSend(prompt);
  };

  return (
    <div className="flex-1 flex items-center justify-center overflow-y-auto">
      <div className="max-w-lg w-full px-4 py-8 text-center">
        {/* Logo */}
        <div className="mb-6">
          <div className="w-16 h-16 rounded-2xl bg-pi-accent/10 border border-pi-accent/20 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={28} className="text-pi-accent" />
          </div>
          <h1 className="text-xl font-display font-bold text-pi-text mb-1">
            Pi Agent
          </h1>
          <p className="text-sm text-pi-dim">
            {projectName} · {modelName}
          </p>
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 mb-6">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            placeholder="Ask pi to help you code..."
            className="flex-1 h-10 px-4 bg-pi-bg-tertiary border border-pi-border rounded-xl
                       text-sm text-pi-text placeholder-pi-dim
                       focus:outline-none focus:border-pi-accent transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl bg-pi-accent text-white flex items-center justify-center
                       hover:bg-pi-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Send size={16} />
          </button>
        </div>

        {/* Quick Starts */}
        <div className="grid grid-cols-2 gap-2">
          {QUICK_STARTS.map((qs) => (
            <button
              key={qs.label}
              onClick={() => handleQuickStart(qs.prompt)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-pi-border
                         hover:border-pi-accent/30 hover:bg-pi-bg-hover transition-all text-left group"
            >
              <span className="text-base">{qs.icon}</span>
              <div>
                <div className="text-xs font-medium text-pi-text group-hover:text-pi-accent transition-colors">
                  {qs.label}
                </div>
                <div className="text-[10px] text-pi-dim truncate max-w-[140px]">
                  {qs.prompt}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
