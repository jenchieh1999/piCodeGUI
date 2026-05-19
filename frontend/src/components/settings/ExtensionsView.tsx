import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import { ArrowLeft, BookOpen, Puzzle, ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '../shared/utils';

export function ExtensionsView() {
  const { t } = useI18n();
  const extensions = useExtensionStore((s) => s.extensions);
  const skills = useExtensionStore((s) => s.skills);
  const toggleExtension = useExtensionStore((s) => s.toggleExtension);
  const toggleSkill = useExtensionStore((s) => s.toggleSkill);
  const setActiveView = useUIStore((s) => s.setActiveView);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-pi-border">
        <button
          onClick={() => setActiveView('chat')}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-pi-bg-hover text-pi-dim hover:text-pi-text transition-colors"
          title={t('common.backToChat')}
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-sm font-display font-semibold text-pi-text">{t('extensions.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Puzzle size={15} className="text-pi-accent" />
            <h2 className="text-xs font-semibold text-pi-text">{t('extensions.runtime')}</h2>
            <span className="text-[10px] text-pi-dim">{extensions.length}</span>
          </div>

          {extensions.length === 0 ? (
            <EmptyList label={t('extensions.emptyRuntime')} />
          ) : (
            <div className="space-y-2">
              {extensions.map((extension) => (
                <button
                  key={`${extension.scope}/${extension.name}`}
                  onClick={() => toggleExtension(extension.name, !extension.enabled)}
                  className="w-full flex items-start gap-3 p-3 rounded-lg border border-pi-border hover:border-pi-muted transition-colors text-left"
                >
                  <Toggle enabled={extension.enabled} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-pi-text">{extension.name}</span>
                      <span className="text-[10px] text-pi-dim">{extension.scope}</span>
                    </div>
                    <div className="text-[10px] text-pi-dim truncate mt-0.5">{extension.path}</div>
                    {extension.description && (
                      <p className="text-[10px] text-pi-muted mt-1">{extension.description}</p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={15} className="text-pi-accent" />
            <h2 className="text-xs font-semibold text-pi-text">{t('extensions.skills')}</h2>
            <span className="text-[10px] text-pi-dim">{skills.length}</span>
          </div>

          {skills.length === 0 ? (
            <EmptyList label={t('extensions.emptySkills')} />
          ) : (
            <div className="space-y-2">
              {skills.map((skill) => (
                <button
                  key={`${skill.scope}/${skill.name}`}
                  onClick={() => toggleSkill(skill.name, !skill.enabled)}
                  className="w-full flex items-start gap-3 p-3 rounded-lg border border-pi-border hover:border-pi-muted transition-colors text-left"
                >
                  <Toggle enabled={skill.enabled} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-pi-text">{skill.name}</span>
                      <span className="text-[10px] text-pi-dim">{skill.scope}</span>
                    </div>
                    <p className="text-[10px] text-pi-muted mt-1">{skill.description}</p>
                    <div className="text-[10px] text-pi-dim truncate mt-1">{skill.filePath}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Toggle({ enabled }: { enabled: boolean }) {
  const Icon = enabled ? ToggleRight : ToggleLeft;

  return (
    <Icon
      size={18}
      className={cn('mt-0.5 flex-shrink-0', enabled ? 'text-pi-success' : 'text-pi-dim')}
    />
  );
}

function EmptyList({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 rounded-lg border border-dashed border-pi-border text-pi-dim">
      <Puzzle size={22} strokeWidth={1} />
      <p className="text-xs mt-2">{label}</p>
    </div>
  );
}
