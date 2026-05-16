import { useModelStore } from '../../stores/modelStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { piApi } from '../../api/client';
import { cn } from '../shared/utils';
import {
  GitBranch,
  Cpu,
  Zap,
  Shield,
  Circle,
} from 'lucide-react';

export function StatusBar() {
  const currentModel = useModelStore((s) => s.currentModel);
  const thinkingLevel = useModelStore((s) => s.thinkingLevel);
  const permissionMode = useSettingsStore((s) => s.permissionMode);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const sessions = useChatStore((s) => s.sessions);
  const isConnected = true; // TODO: track from api client

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const thinkingColors: Record<string, string> = {
    off: 'text-pi-thinking-off',
    minimal: 'text-pi-thinking-minimal',
    low: 'text-pi-thinking-low',
    medium: 'text-pi-thinking-medium',
    high: 'text-pi-thinking-high',
    xhigh: 'text-pi-thinking-xhigh',
  };

  const nextPermissionMode = () => {
    const modes: Array<'ask' | 'acceptEdits' | 'plan' | 'bypassPermissions'> = [
      'ask', 'acceptEdits', 'plan', 'bypassPermissions',
    ];
    const idx = modes.indexOf(permissionMode);
    updateSetting('permissionMode', modes[(idx + 1) % modes.length]);
  };

  const nextThinkingLevel = () => {
    const levels: Array<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'> = [
      'off', 'minimal', 'low', 'medium', 'high', 'xhigh',
    ];
    const idx = levels.indexOf(thinkingLevel);
    const next = levels[(idx + 1) % levels.length];
    piApi.send({ type: 'set_thinking_level', level: next });
  };

  const permissionIcons: Record<string, string> = {
    ask: '🛡️',
    acceptEdits: '✏️',
    plan: '📋',
    bypassPermissions: '⚠️',
  };

  return (
    <div className="flex items-center h-7 px-3 bg-pi-bg-secondary border-t border-pi-border text-[11px] text-pi-dim select-none gap-3">
      {/* Left: Project info */}
      <div className="flex items-center gap-2">
        <GitBranch size={12} />
        <span className="truncate max-w-[200px]">
          {activeSession
            ? `${activeSession.projectName}${activeSession.branch ? ` · ${activeSession.branch}` : ''}`
            : 'No project'}
        </span>
      </div>

      <div className="flex-1" />

      {/* Center: Model & Thinking */}
      <div className="flex items-center gap-3">
        {/* Model */}
        <button
          className="flex items-center gap-1 hover:text-pi-text transition-colors cursor-pointer"
          title="Change model (Ctrl+L)"
        >
          <Cpu size={12} />
          <span>{currentModel?.name ?? 'No model'}</span>
        </button>

        {/* Thinking level */}
        <button
          onClick={nextThinkingLevel}
          className={cn(
            'flex items-center gap-1 hover:text-pi-text transition-colors cursor-pointer',
            thinkingColors[thinkingLevel]
          )}
          title={`Thinking: ${thinkingLevel} (Shift+Tab)`}
        >
          <Zap size={12} />
          <span className="capitalize">{thinkingLevel}</span>
        </button>
      </div>

      <div className="flex-1" />

      {/* Right: Permission & Connection */}
      <div className="flex items-center gap-3">
        {/* Permission mode */}
        <button
          onClick={nextPermissionMode}
          className="flex items-center gap-1 hover:text-pi-text transition-colors cursor-pointer"
          title={`Permission: ${permissionMode} (Click to cycle)`}
        >
          <span className="text-xs">{permissionIcons[permissionMode]}</span>
          <span className="capitalize">
            {permissionMode === 'acceptEdits' ? 'Auto Edit' :
             permissionMode === 'bypassPermissions' ? 'Bypass' :
             permissionMode}
          </span>
        </button>

        {/* Connection status */}
        <div className={cn(
          'flex items-center gap-1',
          isConnected ? 'text-pi-success' : 'text-pi-error'
        )}>
          <Circle size={8} fill="currentColor" />
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
    </div>
  );
}
