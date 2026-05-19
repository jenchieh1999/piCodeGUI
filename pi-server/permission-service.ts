import {
  clearPermissionAudit,
  clearPermissionRules,
  deletePermissionRule,
  loadPermissionAudit,
  loadPermissionRules,
} from './permission-store.js';

interface JsonResponse {
  status: number;
  body: unknown;
}

export function handlePermissionRequest(rawUrl: string, method: string): JsonResponse | null {
  const url = new URL(rawUrl, 'http://127.0.0.1');
  const pathname = url.pathname;

  if (pathname === '/api/permissions/rules' && method === 'GET') {
    return {
      status: 200,
      body: { rules: loadPermissionRules() },
    };
  }

  if (pathname === '/api/permissions/rules' && method === 'DELETE') {
    clearPermissionRules();
    return {
      status: 200,
      body: { rules: [] },
    };
  }

  const ruleMatch = /^\/api\/permissions\/rules\/([^/]+)$/.exec(pathname);
  if (ruleMatch && method === 'DELETE') {
    const deleted = deletePermissionRule(decodeURIComponent(ruleMatch[1]!));
    return {
      status: deleted ? 200 : 404,
      body: { deleted },
    };
  }

  if (pathname === '/api/permissions/audit' && method === 'GET') {
    const limit = Number(url.searchParams.get('limit') ?? 100);
    return {
      status: 200,
      body: { entries: loadPermissionAudit(Number.isFinite(limit) ? limit : 100) },
    };
  }

  if (pathname === '/api/permissions/audit' && method === 'DELETE') {
    clearPermissionAudit();
    return {
      status: 200,
      body: { entries: [] },
    };
  }

  return null;
}
