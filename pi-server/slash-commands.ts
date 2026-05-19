import type { PackageData, SlashCommandData } from './types.js';

const BUILTIN_SLASH_COMMANDS: SlashCommandData[] = [
  { name: '/commit', description: 'Summarize changes and prepare a commit.', category: 'Git', source: 'builtin' },
  { name: '/review', description: 'Review current changes for bugs and regressions.', category: 'Code', source: 'builtin' },
  { name: '/debug', description: 'Investigate a failing behavior or error.', category: 'Code', source: 'builtin' },
  { name: '/test', description: 'Run or design the relevant test flow.', category: 'Code', source: 'builtin' },
  { name: '/explain', description: 'Explain the selected code or current project area.', category: 'Code', source: 'builtin' },
  { name: '/compact', description: 'Compact the current conversation context.', category: 'Session', source: 'builtin' },
  { name: '/tree', description: 'Open the session checkpoint tree.', category: 'Session', source: 'builtin' },
  { name: '/fork', description: 'Fork from the current checkpoint.', category: 'Session', source: 'builtin' },
  { name: '/new', description: 'Start a new project session.', category: 'Session', source: 'builtin' },
  { name: '/memory', description: 'Inspect or update durable project memory.', category: 'Runtime', source: 'builtin' },
];

export function getSlashCommands(packages: PackageData[] = []): SlashCommandData[] {
  const extensionCommands = packages.flatMap((pkg) =>
    (pkg.prompts ?? []).map<SlashCommandData>((prompt) => {
      const normalized = prompt.startsWith('/') ? prompt : `/${prompt}`;
      return {
        name: normalized,
        description: `Run prompt from ${pkg.name}.`,
        category: 'Extension',
        source: 'extension',
      };
    })
  );

  return dedupeCommands([...extensionCommands, ...BUILTIN_SLASH_COMMANDS]);
}

function dedupeCommands(commands: SlashCommandData[]): SlashCommandData[] {
  const seen = new Set<string>();
  const result: SlashCommandData[] = [];

  for (const command of commands) {
    const name = normalizeCommandName(command.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push({ ...command, name });
  }

  return result.sort((a, b) => {
    const category = (a.category ?? '').localeCompare(b.category ?? '');
    return category !== 0 ? category : a.name.localeCompare(b.name);
  });
}

function normalizeCommandName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
