import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDataDir } from './persistence.js';
import type { PermissionAuditEntryData, PermissionRuleData } from './types.js';

const PERMISSIONS_DIR = path.join(getDataDir(), 'permissions');
const RULES_PATH = path.join(PERMISSIONS_DIR, 'rules.json');
const AUDIT_PATH = path.join(PERMISSIONS_DIR, 'audit.json');
const MAX_AUDIT_ENTRIES = 500;

export function loadPermissionRules(): PermissionRuleData[] {
  return readJsonFile<PermissionRuleData[]>(RULES_PATH, []);
}

export function savePermissionRules(rules: PermissionRuleData[]): void {
  atomicWriteJson(RULES_PATH, rules);
}

export function upsertPermissionRule(rule: PermissionRuleData): PermissionRuleData {
  const rules = loadPermissionRules();
  const existingIndex = rules.findIndex((item) => item.id === rule.id);
  const nextRules = existingIndex >= 0
    ? rules.map((item) => (item.id === rule.id ? rule : item))
    : [rule, ...rules];
  savePermissionRules(nextRules);
  return rule;
}

export function deletePermissionRule(ruleId: string): boolean {
  const rules = loadPermissionRules();
  const nextRules = rules.filter((rule) => rule.id !== ruleId);
  if (nextRules.length === rules.length) return false;
  savePermissionRules(nextRules);
  return true;
}

export function clearPermissionRules(): void {
  savePermissionRules([]);
}

export function loadPermissionAudit(limit = 100): PermissionAuditEntryData[] {
  return readJsonFile<PermissionAuditEntryData[]>(AUDIT_PATH, []).slice(0, Math.max(0, limit));
}

export function appendPermissionAudit(entry: PermissionAuditEntryData): void {
  const entries = readJsonFile<PermissionAuditEntryData[]>(AUDIT_PATH, []);
  atomicWriteJson(AUDIT_PATH, [entry, ...entries].slice(0, MAX_AUDIT_ENTRIES));
}

export function clearPermissionAudit(): void {
  atomicWriteJson(AUDIT_PATH, []);
}

function readJsonFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;

  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (err) {
    console.warn(`[PiServer] Failed to read ${file}:`, err);
    return fallback;
  }
}

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}
