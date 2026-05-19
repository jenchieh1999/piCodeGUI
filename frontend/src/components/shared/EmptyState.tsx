import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { useI18n } from '../../lib/i18n';
import { MessageSquare, Settings, Sparkles } from 'lucide-react';
import { ProjectLauncher } from './ProjectLauncher';

export function EmptyState() {
  const { t } = useI18n();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const sessions = useChatStore((s) => s.sessions);

  return (
    <div className="flex-1 flex items-center justify-center overflow-y-auto">
      <div className="max-w-4xl w-full px-4 py-8 text-center">
        {/* Central visual */}
        <div className="mb-6">
          <div className="w-14 h-14 rounded-xl bg-pi-accent/5 border border-pi-accent/10 flex items-center justify-center mx-auto mb-3">
            <Sparkles size={28} className="text-pi-accent/45" />
          </div>
          <h2 className="text-lg font-display font-semibold text-pi-text mb-1">
            Pi Desktop
          </h2>
          <p className="text-sm text-pi-dim max-w-sm mx-auto whitespace-pre-line">{t('empty.description')}</p>
        </div>

        <ProjectLauncher />

        {/* Actions */}
        <div className="mt-5 flex flex-wrap gap-2 items-center justify-center">
          {sessions.length > 0 && (
            <button
              onClick={() => {
                if (sessions[0]) {
                  useChatStore.getState().setActiveSession(sessions[0].id);
                  setActiveView('chat');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-pi-muted
                         hover:text-pi-text hover:bg-pi-bg-hover transition-all"
            >
              <MessageSquare size={15} />
              {t('empty.continue')}
            </button>
          )}

          <button
            onClick={() => setActiveView('settings')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-pi-dim
                       hover:text-pi-muted hover:bg-pi-bg-hover transition-all"
          >
            <Settings size={15} />
            {t('empty.openSettings')}
          </button>
        </div>

        {/* Keyboard shortcuts */}
        <div className="mt-6 flex items-center justify-center gap-4 text-[10px] text-pi-dim">
          <span><kbd className="px-1 py-0.5 rounded bg-pi-bg-tertiary border border-pi-border font-mono">Ctrl+N</kbd> {t('empty.shortcutNewSession')}</span>
          <span><kbd className="px-1 py-0.5 rounded bg-pi-bg-tertiary border border-pi-border font-mono">Ctrl+L</kbd> {t('empty.shortcutSwitchModel')}</span>
        </div>
      </div>
    </div>
  );
}
