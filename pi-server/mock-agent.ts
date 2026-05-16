// ============================================================
// Pi Agent Server - Mock Session & Agent Manager
// Development mock that simulates pi SDK behavior
// Replace with real pi SDK integration for production
// ============================================================

import type {
  SessionData, ModelData, ProviderData, ThinkingLevel,
  PackageData, ExtensionData, ThemeData, TokenUsageData,
  PermissionRequestData, ToolUseData, ToolResultData,
} from './types.js';

// ---- In-memory state ----

const sessions: Map<string, SessionData> = new Map();
const providers: ProviderData[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic', reasoning: true, contextWindow: 200000, maxTokens: 8192, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', provider: 'anthropic', reasoning: true, contextWindow: 200000, maxTokens: 8192, cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic', reasoning: false, contextWindow: 200000, maxTokens: 4096, cost: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai', reasoning: false, contextWindow: 128000, maxTokens: 4096, cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 } },
      { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai', reasoning: false, contextWindow: 1000000, maxTokens: 32768, cost: { input: 2, output: 8, cacheRead: 0, cacheWrite: 0 } },
    ],
  },
];

let currentModel: ModelData = providers[0]!.models[0]!;
let currentThinkingLevel: ThinkingLevel = 'off';

const packages: Map<string, PackageData> = new Map();
const extensions: ExtensionData[] = [];
const themes: ThemeData[] = [
  {
    name: 'dark',
    colors: {
      accent: '#00aaff', border: '#3a3a3e', borderAccent: '#00aaff', borderMuted: '#2a2a2e',
      success: '#00cc66', error: '#ff4444', warning: '#ffaa00', muted: '#888892', dim: '#55555a',
      text: '#e0e0e8', thinkingText: '#a0a0b0', selectedBg: '#2d2d38',
      userMessageBg: '#2d2d38', userMessageText: '#e0e0e8',
      customMessageBg: '#2d2d38', customMessageText: '#e0e0e8', customMessageLabel: '#00aaff',
      toolPendingBg: '#1e1e2e', toolSuccessBg: '#1e2e1e', toolErrorBg: '#2e1e1e',
      toolTitle: '#00aaff', toolOutput: '#c0c0d0',
      mdHeading: '#ffaa00', mdLink: '#00aaff', mdLinkUrl: '#888892',
      mdCode: '#00ffff', mdCodeBlock: '#e0e0e8', mdCodeBlockBorder: '#3a3a3e',
      mdQuote: '#888892', mdQuoteBorder: '#3a3a3e', mdHr: '#3a3a3e', mdListBullet: '#00ffff',
      toolDiffAdded: '#00cc66', toolDiffRemoved: '#ff4444', toolDiffContext: '#888892',
      syntaxComment: '#888892', syntaxKeyword: '#00aaff', syntaxFunction: '#00ccff',
      syntaxVariable: '#ffaa00', syntaxString: '#00cc66', syntaxNumber: '#ff66cc',
      syntaxType: '#00ccff', syntaxOperator: '#00aaff', syntaxPunctuation: '#888892',
      thinkingOff: '#55555a', thinkingMinimal: '#00aaff', thinkingLow: '#00ccff',
      thinkingMedium: '#00ffff', thinkingHigh: '#ff66cc', thinkingXhigh: '#ff4444',
      bashMode: '#ffaa00',
    },
  },
  {
    name: 'light',
    colors: {
      accent: '#0066cc', border: '#d4d4d8', borderAccent: '#0066cc', borderMuted: '#e4e4e7',
      success: '#008a3a', error: '#cc0000', warning: '#cc8800', muted: '#71717a', dim: '#a1a1aa',
      text: '#18181b', thinkingText: '#52525b', selectedBg: '#e4e4e7',
      userMessageBg: '#f4f4f5', userMessageText: '#18181b',
      customMessageBg: '#f4f4f5', customMessageText: '#18181b', customMessageLabel: '#0066cc',
      toolPendingBg: '#f0f0ff', toolSuccessBg: '#f0fff0', toolErrorBg: '#fff0f0',
      toolTitle: '#0066cc', toolOutput: '#3f3f46',
      mdHeading: '#cc8800', mdLink: '#0066cc', mdLinkUrl: '#71717a',
      mdCode: '#008888', mdCodeBlock: '#18181b', mdCodeBlockBorder: '#d4d4d8',
      mdQuote: '#71717a', mdQuoteBorder: '#d4d4d8', mdHr: '#d4d4d8', mdListBullet: '#008888',
      toolDiffAdded: '#008a3a', toolDiffRemoved: '#cc0000', toolDiffContext: '#71717a',
      syntaxComment: '#71717a', syntaxKeyword: '#0066cc', syntaxFunction: '#0088cc',
      syntaxVariable: '#cc8800', syntaxString: '#008a3a', syntaxNumber: '#cc44aa',
      syntaxType: '#0088cc', syntaxOperator: '#0066cc', syntaxPunctuation: '#71717a',
      thinkingOff: '#a1a1aa', thinkingMinimal: '#0066cc', thinkingLow: '#0088cc',
      thinkingMedium: '#008888', thinkingHigh: '#cc44aa', thinkingXhigh: '#cc0000',
      bashMode: '#cc8800',
    },
  },
];

let sessionCounter = 0;
let messageCounter = 0;

// ---- Session Management ----

export function createSession(projectPath: string): SessionData {
  const id = `session-${++sessionCounter}`;
  const projectName = projectPath === '.' ? 'current-project' : projectPath.split('/').pop() || projectPath;

  const session: SessionData = {
    id,
    title: `New Session ${sessionCounter}`,
    projectPath,
    projectName,
    branch: 'main',
    modelId: currentModel.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'idle',
    messageCount: 0,
  };

  sessions.set(id, session);
  return session;
}

export function getSession(id: string): SessionData | undefined {
  return sessions.get(id);
}

export function getAllSessions(): SessionData[] {
  return Array.from(sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function renameSession(id: string, title: string): SessionData | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.title = title;
  session.updatedAt = Date.now();
  return session;
}

// ---- Model Management ----

export function getCurrentModel(): ModelData {
  return currentModel;
}

export function getProviders(): ProviderData[] {
  return providers;
}

export function getThinkingLevel(): ThinkingLevel {
  return currentThinkingLevel;
}

export function setThinkingLevel(level: ThinkingLevel): ThinkingLevel {
  currentThinkingLevel = level;
  return level;
}

export function setModel(modelId: string, provider: string): ModelData | null {
  const prov = providers.find((p) => p.id === provider);
  if (!prov) return null;
  const model = prov.models.find((m) => m.id === modelId);
  if (!model) return null;
  currentModel = model;
  return model;
}

// ---- Package Management ----

export function getPackages(): PackageData[] {
  return Array.from(packages.values());
}

export function installPackage(source: string): PackageData {
  const name = source.replace(/^(npm:|git:|https:\/\/)/, '').split('@')[0] ?? 'unknown';
  const pkg: PackageData = {
    name,
    version: '1.0.0',
    source,
    installedAt: Date.now(),
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };
  packages.set(source, pkg);
  return pkg;
}

export function removePackage(source: string): boolean {
  return packages.delete(source);
}

export function getExtensions(): ExtensionData[] {
  return extensions;
}

export function getThemes(): ThemeData[] {
  return themes;
}

// ---- Mock Agent Response Generator ----

export interface AgentCallbacks {
  sendMessage: (msg: Record<string, unknown>) => void;
}

export async function simulateAgentResponse(
  sessionId: string,
  userMessage: string,
  callbacks: AgentCallbacks
): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;

  session.status = 'running';
  callbacks.sendMessage({ type: 'status', sessionId, status: 'running' });

  const msgId = `msg-${++messageCounter}`;

  // Simulate thinking
  callbacks.sendMessage({ type: 'thinking_start', sessionId });
  const thoughts = [
    `Let me analyze the user's request: "${userMessage.slice(0, 80)}${userMessage.length > 80 ? '...' : ''}"`,
    `Current project: ${session.projectName}, working in ${session.projectPath}`,
    `I should check the relevant files and understand the context before responding.`,
  ];

  for (const thought of thoughts) {
    callbacks.sendMessage({ type: 'thinking_delta', sessionId, delta: thought + '\n' });
    await sleep(300 + Math.random() * 400);
  }
  callbacks.sendMessage({ type: 'thinking_end', sessionId });

  // Simulate tool calls
  if (userMessage.toLowerCase().includes('file') || userMessage.toLowerCase().includes('code') || userMessage.toLowerCase().includes('read')) {
    const toolId = `tool-${++messageCounter}`;
    const toolUse: ToolUseData = {
      id: toolId,
      name: 'read',
      args: { path: 'src/index.ts' },
    };
    callbacks.sendMessage({ type: 'tool_use', sessionId, toolCall: toolUse });

    await sleep(400 + Math.random() * 300);

    const toolResult: ToolResultData = {
      toolCallId: toolId,
      content: '// Sample file content\nimport { something } from "./module";\n\nexport function main() {\n  console.log("Hello from pi!");\n}',
      isError: false,
    };
    callbacks.sendMessage({ type: 'tool_result', sessionId, result: toolResult });
  }

  if (userMessage.toLowerCase().includes('bash') || userMessage.toLowerCase().includes('run') || userMessage.toLowerCase().includes('execute')) {
    // Permission request for bash
    const permId = `perm-${++messageCounter}`;
    const permRequest: PermissionRequestData = {
      requestId: permId,
      toolName: 'bash',
      args: { command: 'npm run build' },
      message: 'Execute build command in the project directory',
      risk: 'medium',
    };
    callbacks.sendMessage({ type: 'permission_request', sessionId, request: permRequest });

    // In mock, auto-allow after delay
    await sleep(2000);

    const toolId = `tool-${++messageCounter}`;
    const toolUse: ToolUseData = {
      id: toolId,
      name: 'bash',
      args: { command: 'npm run build' },
    };
    callbacks.sendMessage({ type: 'tool_use', sessionId, toolCall: toolUse });

    await sleep(600 + Math.random() * 500);

    const toolResult: ToolResultData = {
      toolCallId: toolId,
      content: '> build\n> tsc && vite build\n\nBuild completed successfully in 2.4s\n✓ 156 modules transformed.',
      isError: false,
    };
    callbacks.sendMessage({ type: 'tool_result', sessionId, result: toolResult });
  }

  // Stream text response
  callbacks.sendMessage({ type: 'text_start', sessionId, messageId: msgId });

  const response = generateResponse(userMessage, session.projectName);

  // Stream word by word for realism
  const words = response.split(' ');
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i];
    callbacks.sendMessage({ type: 'text_delta', sessionId, delta: chunk });
    await sleep(15 + Math.random() * 35);
  }

  callbacks.sendMessage({ type: 'text_end', sessionId, messageId: msgId });

  // Message complete with usage
  const usage: TokenUsageData = {
    input: 150 + Math.floor(Math.random() * 300),
    output: response.length / 4 + Math.floor(Math.random() * 100),
    cacheRead: Math.floor(Math.random() * 100),
    cacheWrite: 0,
    cost: 0.01 + Math.random() * 0.05,
  };
  callbacks.sendMessage({ type: 'message_complete', sessionId, messageId: msgId, usage });

  session.status = 'idle';
  session.messageCount++;
  session.updatedAt = Date.now();
  callbacks.sendMessage({ type: 'status', sessionId, status: 'idle' });
}

function generateResponse(message: string, projectName: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
    return `Hello! I'm Pi, your coding assistant. I'm working in the **${projectName}** project. How can I help you today?\n\nI can help you with:\n- Reading and understanding code\n- Writing and editing files\n- Running commands\n- Debugging issues\n- And much more!`;
  }

  if (lower.includes('what') && (lower.includes('file') || lower.includes('project') || lower.includes('structure'))) {
    return `Here's an overview of the **${projectName}** project structure:\n\n\`\`\`\nsrc/\n├── components/   # React components\n├── stores/       # State management\n├── api/          # API client\n├── types/        # TypeScript types\n└── hooks/        # Custom hooks\n\`\`\`\n\nThis is a modern TypeScript project using React for the UI layer. The code follows a modular architecture with clear separation of concerns.`;
  }

  if (lower.includes('code') || lower.includes('function') || lower.includes('component')) {
    return "Here's a sample React component that you might find useful:\n\n\`\`\`typescript\nimport React from 'react';\n\ninterface ButtonProps {\n  label: string;\n  onClick: () => void;\n  variant?: 'primary' | 'secondary';\n}\n\nexport function Button({ label, onClick, variant = 'primary' }: ButtonProps) {\n  return (\n    <button\n      onClick={onClick}\n      className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'}\n    >\n      {label}\n    </button>\n  );\n}\n\`\`\`\n\nThis component is reusable, type-safe, and follows best practices for accessibility.";
  }

  if (lower.includes('help') || lower.includes('?')) {
    return "I'm here to help! Here are some things I can do:\n\n| Capability | Description |\n|------------|-------------|\n| **Read files** | I can read and analyze any file in your project |\n| **Write code** | I can create new files and components |\n| **Edit code** | I can make precise edits to existing files |\n| **Run commands** | I can execute bash commands (with your permission) |\n| **Debug** | I can help find and fix bugs |\n\nJust tell me what you need!";
  }

  return `I understand you're asking about "${message.slice(0, 60)}${message.length > 60 ? '...' : ''}".\n\nLet me help you with that. Based on the **${projectName}** project context, here's what I think:\n\n1. First, we should examine the relevant source files\n2. Then, we can plan the appropriate changes\n3. Finally, we'll implement and test the solution\n\nWhat specific aspect would you like me to focus on?`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
