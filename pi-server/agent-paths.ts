import os from 'node:os';
import path from 'node:path';

export function getAgentDir(): string {
  return process.env.PI_AGENT_DIR?.trim() || path.join(os.homedir(), '.pi', 'agent');
}

export function getAuthPath(): string {
  return path.join(getAgentDir(), 'auth.json');
}

export function getModelsPath(): string {
  return path.join(getAgentDir(), 'models.json');
}
