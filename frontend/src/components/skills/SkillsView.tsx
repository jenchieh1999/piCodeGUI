import { ArrowLeft, BookOpen, Box, CheckCircle2, Package, Search, ToggleLeft, ToggleRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import type { SkillInfo } from '../../types';
import { cn } from '../shared/utils';

type SkillFilter = 'all' | 'enabled' | 'disabled' | 'project' | 'user';

export function SkillsView() {
  const { t } = useI18n();
  const skills = useExtensionStore((s) => s.skills);
  const packages = useExtensionStore((s) => s.packages);
  const toggleSkill = useExtensionStore((s) => s.toggleSkill);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SkillFilter>('all');

  const filtered = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    return skills
      .filter((skill) => {
        if (filter === 'enabled' && !skill.enabled) return false;
        if (filter === 'disabled' && skill.enabled) return false;
        if (filter === 'project' && skill.scope !== 'project') return false;
        if (filter === 'user' && skill.scope !== 'user') return false;
        if (!lowerQuery) return true;
        return `${skill.name} ${skill.description} ${skill.filePath} ${skill.scope}`.toLowerCase().includes(lowerQuery);
      })
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  }, [filter, query, skills]);

  const enabledCount = skills.filter((skill) => skill.enabled).length;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 border-b border-pi-border px-4 py-3">
        <button
          onClick={() => setActiveView('chat')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          title={t('common.backToChat')}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-display font-semibold text-pi-text">{t('skills.title')}</h1>
          <div className="mt-0.5 text-[10px] text-pi-dim">
            {t('skills.summary', { enabled: enabledCount, total: skills.length, packages: packages.length })}
          </div>
        </div>
        <button
          onClick={() => setActiveView('packages')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
        >
          <Package size={13} />
          {t('skills.packages')}
        </button>
      </div>

      <div className="border-b border-pi-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pi-dim" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('skills.searchPlaceholder')}
              className="h-8 w-full rounded-md border border-pi-border bg-pi-bg-tertiary pl-8 pr-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
            />
          </div>
          {(['all', 'enabled', 'disabled', 'project', 'user'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={cn(
                'h-8 rounded-md border px-3 text-xs font-medium transition-colors',
                filter === item
                  ? 'border-pi-accent bg-pi-selected-bg text-pi-accent'
                  : 'border-pi-border text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
              )}
            >
              {t(`skills.filter.${item}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-pi-border text-pi-dim">
            <BookOpen size={32} strokeWidth={1} />
            <div className="text-xs">{t('skills.empty')}</div>
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {filtered.map((skill) => (
              <SkillCard
                key={`${skill.scope}/${skill.name}/${skill.filePath}`}
                skill={skill}
                onToggle={() => toggleSkill(skill.name, !skill.enabled)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill, onToggle }: { skill: SkillInfo; onToggle: () => void }) {
  const { t } = useI18n();
  const ToggleIcon = skill.enabled ? ToggleRight : ToggleLeft;
  const scopeLabel = skill.scope === 'project'
    ? t('skills.scope.project')
    : skill.scope === 'user'
      ? t('skills.scope.user')
      : skill.scope;

  return (
    <button
      onClick={onToggle}
      className={cn(
        'group rounded-lg border bg-pi-bg-secondary p-3 text-left transition-colors',
        skill.enabled ? 'border-pi-border hover:border-pi-accent/50' : 'border-pi-border opacity-75 hover:opacity-100'
      )}
    >
      <div className="flex items-start gap-3">
        <ToggleIcon
          size={20}
          className={cn('mt-0.5 flex-shrink-0', skill.enabled ? 'text-pi-success' : 'text-pi-dim group-hover:text-pi-muted')}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-pi-text">{skill.name}</span>
            <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-dim">
              {scopeLabel}
            </span>
            {skill.enabled && (
              <span className="inline-flex items-center gap-1 rounded bg-pi-success/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-success">
                <CheckCircle2 size={10} />
                {t('skills.enabledBadge')}
              </span>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-pi-muted">{skill.description}</p>
          <div className="mt-3 flex items-center gap-1.5 truncate font-mono text-[10px] text-pi-dim">
            <Box size={11} className="flex-shrink-0" />
            <span className="truncate">{skill.filePath}</span>
          </div>
        </div>
      </div>
    </button>
  );
}
