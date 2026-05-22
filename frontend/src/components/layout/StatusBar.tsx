import { useModelStore } from '../../stores/modelStore';
import { useChatStore } from '../../stores/chatStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useUIStore } from '../../stores/uiStore';
import { piApi } from '../../api/client';
import { cn } from '../shared/utils';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { thinkingLevelPillClass } from '../../lib/thinkingLevelStyles';
import type { ModelInfo, Session, ThinkingLevel } from '../../types';
import {
  Circle,
  Cpu,
  GitBranch,
  MonitorCog,
  Zap,
} from 'lucide-react';

export function StatusBar() {
  const { t } = useI18n();
  const globalCurrentModel = useModelStore((s) => s.currentModel);
  const availableModels = useModelStore((s) => s.availableModels);
  const globalThinkingLevel = useModelStore((s) => s.thinkingLevel);
  const addToast = useUIStore((s) => s.addToast);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sessions = useChatStore((s) => s.sessions);
  const updateSession = useChatStore((s) => s.updateSession);
  const isConnected = useConnectionStore((s) => s.isConnected);
  const reconnectAttempts = useConnectionStore((s) => s.reconnectAttempts);
  const runtimeInfo = useConnectionStore((s) => s.runtimeInfo);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const currentModel = modelForSession(activeSession, availableModels, globalCurrentModel);
  const thinkingLevel = activeSession?.thinkingLevel ?? globalThinkingLevel;
  const isDesktop = typeof window !== 'undefined' && Boolean(window.piDesktop);

  const thinkingLabel = thinkingLevelLabel(thinkingLevel, t);

  const nextThinkingLevel = () => {
    const levels: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'> = [
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ];
    const idx = levels.indexOf(thinkingLevel);
    const next = levels[(idx + 1) % levels.length];
    const sent = piApi.send({ type: 'set_thinking_level', sessionId: activeSessionId ?? undefined, level: next });
    if (!sent) {
      addToast({ type: 'error', message: t('chat.switchThinkingDisconnected') });
      return;
    }
    if (activeSession) {
      updateSession({ ...activeSession, thinkingLevel: next, updatedAt: Date.now() });
    } else {
      useModelStore.getState().setThinkingLevel(next);
    }
  };

  return (
    <div className="pi-statusbar-material flex h-7 items-center gap-3 border-t px-3 text-[11px] text-pi-dim select-none">
      <div className="flex min-w-0 items-center gap-2 rounded-full px-2 py-0.5">
        <GitBranch size={12} />
        <span className="max-w-[220px] truncate">
          {activeSession
            ? activeSession.branch
              ? t('status.branchOn', { project: activeSession.projectName, branch: activeSession.branch })
              : activeSession.projectName
            : t('status.noProject')}
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <button
          className="flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 transition-colors hover:bg-pi-bg-hover/70 hover:text-pi-text"
          title={t('status.changeModel')}
        >
          <Cpu size={12} />
          <span>{currentModel?.name ?? t('status.noModel')}</span>
        </button>

        <button
          onClick={nextThinkingLevel}
          className={cn(
            'flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 transition-colors',
            thinkingLevelPillClass(thinkingLevel)
          )}
          title={t('status.thinkingCycle', { level: thinkingLabel })}
        >
          <Zap size={12} />
          <span>{thinkingLabel}</span>
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {isDesktop && (
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('pi:desktop-open-diagnostics'))}
            className="flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 transition-colors hover:bg-pi-bg-hover/70 hover:text-pi-text"
            title={t('status.desktopDiagnostics')}
          >
            <MonitorCog size={12} />
            <span>{t('status.desktop')}</span>
          </button>
        )}

        {runtimeInfo && (
          <div
            className={cn(
              'flex items-center gap-1 rounded-full px-2 py-0.5',
              runtimeInfo.active === 'pi' && !runtimeInfo.fallback ? 'text-pi-success' : 'text-pi-warning'
            )}
            title={runtimeInfo.detail ?? t('status.runtimeTitle', { mode: runtimeInfo.mode, active: runtimeInfo.active })}
          >
            <Cpu size={12} />
            <span>{runtimeInfo.fallback ? t('status.mockFallback') : runtimeInfo.active === 'pi' ? t('status.piSdk') : t('status.mock')}</span>
          </div>
        )}

        <div className={cn(
          'flex items-center gap-1 rounded-full px-2 py-0.5',
          isConnected ? 'text-pi-success' : 'text-pi-error'
        )}>
          <Circle size={8} fill="currentColor" />
          <span>
            {isConnected
              ? t('status.connected')
              : reconnectAttempts > 0
                ? t('status.reconnecting', { count: reconnectAttempts })
                : t('status.disconnected')}
          </span>
        </div>
      </div>
    </div>
  );
}

function modelForSession(session: Session | undefined, models: ModelInfo[], fallback: ModelInfo | null): ModelInfo | null {
  if (!session) return fallback;
  const provider = session.modelProvider;
  return models.find((model) => model.id === session.modelId && (!provider || model.provider === provider))
    ?? models.find((model) => model.id === session.modelId)
    ?? fallback;
}

function thinkingLevelLabel(
  level: ThinkingLevel,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  return t(`chat.thinking.${level}` as TranslationKey);
}
