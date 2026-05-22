import type { ThinkingLevel } from '../types';

const thinkingLevelPillClasses: Record<ThinkingLevel, string> = {
  off: 'border-pi-thinking-off/35 bg-pi-thinking-off/10 text-pi-thinking-off hover:border-pi-thinking-off/50 hover:bg-pi-thinking-off/15 hover:text-pi-thinking-off',
  minimal:
    'border-pi-thinking-minimal/35 bg-pi-thinking-minimal/10 text-pi-thinking-minimal hover:border-pi-thinking-minimal/50 hover:bg-pi-thinking-minimal/15 hover:text-pi-thinking-minimal',
  low: 'border-pi-thinking-low/35 bg-pi-thinking-low/10 text-pi-thinking-low hover:border-pi-thinking-low/50 hover:bg-pi-thinking-low/15 hover:text-pi-thinking-low',
  medium:
    'border-pi-thinking-medium/35 bg-pi-thinking-medium/10 text-pi-thinking-medium hover:border-pi-thinking-medium/50 hover:bg-pi-thinking-medium/15 hover:text-pi-thinking-medium',
  high: 'border-pi-thinking-high/35 bg-pi-thinking-high/10 text-pi-thinking-high hover:border-pi-thinking-high/50 hover:bg-pi-thinking-high/15 hover:text-pi-thinking-high',
  xhigh:
    'border-pi-thinking-xhigh/35 bg-pi-thinking-xhigh/10 text-pi-thinking-xhigh hover:border-pi-thinking-xhigh/50 hover:bg-pi-thinking-xhigh/15 hover:text-pi-thinking-xhigh',
};

const thinkingLevelSelectedPillClasses: Record<ThinkingLevel, string> = {
  off: 'border-pi-thinking-off/55 bg-pi-thinking-off/15 text-pi-thinking-off hover:border-pi-thinking-off/70 hover:bg-pi-thinking-off/20 hover:text-pi-thinking-off',
  minimal:
    'border-pi-thinking-minimal/55 bg-pi-thinking-minimal/15 text-pi-thinking-minimal hover:border-pi-thinking-minimal/70 hover:bg-pi-thinking-minimal/20 hover:text-pi-thinking-minimal',
  low: 'border-pi-thinking-low/55 bg-pi-thinking-low/15 text-pi-thinking-low hover:border-pi-thinking-low/70 hover:bg-pi-thinking-low/20 hover:text-pi-thinking-low',
  medium:
    'border-pi-thinking-medium/55 bg-pi-thinking-medium/15 text-pi-thinking-medium hover:border-pi-thinking-medium/70 hover:bg-pi-thinking-medium/20 hover:text-pi-thinking-medium',
  high: 'border-pi-thinking-high/55 bg-pi-thinking-high/15 text-pi-thinking-high hover:border-pi-thinking-high/70 hover:bg-pi-thinking-high/20 hover:text-pi-thinking-high',
  xhigh:
    'border-pi-thinking-xhigh/55 bg-pi-thinking-xhigh/15 text-pi-thinking-xhigh hover:border-pi-thinking-xhigh/70 hover:bg-pi-thinking-xhigh/20 hover:text-pi-thinking-xhigh',
};

const thinkingLevelTextClasses: Record<ThinkingLevel, string> = {
  off: 'text-pi-thinking-off',
  minimal: 'text-pi-thinking-minimal',
  low: 'text-pi-thinking-low',
  medium: 'text-pi-thinking-medium',
  high: 'text-pi-thinking-high',
  xhigh: 'text-pi-thinking-xhigh',
};

export function thinkingLevelPillClass(level: ThinkingLevel, selected = false): string {
  return selected ? thinkingLevelSelectedPillClasses[level] : thinkingLevelPillClasses[level];
}

export function thinkingLevelTextClass(level: ThinkingLevel): string {
  return thinkingLevelTextClasses[level];
}
