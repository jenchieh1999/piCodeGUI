import type { ChatMessageData } from './types.js';

const MAX_TITLE_LENGTH = 22;

const INTENT_TITLES: Array<{ pattern: RegExp; title: string }> = [
  { pattern: /(自动|生成).{0,12}(会话)?标题|session.{0,12}title|title.{0,12}session/i, title: '自动生成会话标题' },
  { pattern: /一键.{0,12}(下拉|滚动).{0,12}底部|滚动.{0,12}底部|scroll.{0,16}bottom/i, title: '添加滚动到底部' },
  { pattern: /(工作目录|当前目录|cwd|working directory)/i, title: '查询当前工作目录' },
  { pattern: /(背景图片|对话背景|chat background|background image)/i, title: '设置对话背景' },
  { pattern: /(飞书|微信|频道|feishu|wechat|channel)/i, title: '配置消息频道' },
  { pattern: /(字体|字号|font size|font family|font)/i, title: '调整字体设置' },
  { pattern: /(是什么|什么).{0,10}(agent|智能体|助手)|自我介绍|introduce yourself|what are you/i, title: '了解 Agent 能力' },
  { pattern: /(黑屏|blank screen|black screen)/i, title: '修复桌面黑屏' },
  { pattern: /(断连|未连接|not connected|connection|connect|reconnect)/i, title: '排查连接问题' },
  { pattern: /(主题|theme|赛博朋克|星球大战|claude code|codex|trae)/i, title: '调整主题风格' },
  { pattern: /(agents?|智能体).{0,20}(功能|配置|调整|完善|clawx|openclaw)/i, title: '完善 Agents 功能' },
  { pattern: /(cc-haha|差距|拉平|追赶|对齐)/i, title: '对齐 cc-haha 体验' },
  { pattern: /(重启|restart).{0,12}(桌面|desktop)/i, title: '重启桌面端' },
  { pattern: /(运行|启动).{0,12}(桌面|agent|desktop)/i, title: '运行桌面端' },
  { pattern: /(debug|调试|报错|错误|bug|fix)/i, title: '排查调试问题' },
];

const ENGLISH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'can', 'could', 'do', 'for',
  'from', 'help', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or',
  'please', 'the', 'this', 'to', 'want', 'we', 'what', 'with', 'would', 'you',
]);

export function generateSessionTitle(messages: ChatMessageData[] | string[]): string | null {
  const texts = messages
    .map((item) => typeof item === 'string' ? item : textFromMessage(item))
    .flatMap(splitIntoCandidates)
    .filter(Boolean);

  if (texts.length === 0) return null;

  const meaningfulTexts = texts.filter((text) => !isGreetingOnly(text));
  const searchText = (meaningfulTexts.length > 0 ? meaningfulTexts : texts).join('\n');
  for (const intent of INTENT_TITLES) {
    if (intent.pattern.test(searchText)) return intent.title;
  }

  const selected = meaningfulTexts[0] ?? texts[0];
  if (!selected) return null;
  if (isGreetingOnly(selected)) return '初次问候';

  return createCompactTitle(selected);
}

function textFromMessage(message: ChatMessageData): string {
  if (message.role !== 'user') return '';
  return message.content
    .filter((content) => content.type === 'text' && content.text)
    .map((content) => content.text ?? '')
    .join('\n');
}

function splitIntoCandidates(value: string): string[] {
  const cleaned = normalizePromptText(value);
  if (!cleaned) return [];

  const parts = cleaned
    .split(/[\n。！？!?；;]+/)
    .map(cleanTitleText)
    .filter((part) => meaningfulLength(part) > 1);

  return parts.length > 0 ? parts : [cleanTitleText(cleaned)].filter(Boolean);
}

function normalizePromptText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[[0-9]+\s+image attachments?\]/gi, ' ')
    .replace(/<\/?(?:channel|agent|description|system_prompt)[^>]*>/gi, ' ')
    .replace(/^\[(?:Feishu|WeChat)(?:[^\]]*)\]\s+[^:：\n]{0,60}[:：]\s*/gim, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitleText(value: string): string {
  return value
    .replace(/^[\s"“”'‘’`]+|[\s"“”'‘’`]+$/g, '')
    .replace(/^(请问|请你|请帮我|帮我|麻烦你|麻烦|我希望|我想要|我想|能不能|可以请你|可以帮我|请)\s*/i, '')
    .replace(/^(please|can you|could you|help me|i want to|i would like to)\s+/i, '')
    .replace(/^(继续|接着)\s+(帮我|请你)?\s*/i, '$1')
    .replace(/[。！？!?；;，,、：:]+$/g, '')
    .trim();
}

function createCompactTitle(value: string): string {
  const cleaned = cleanTitleText(value);
  if (containsCjk(cleaned)) {
    return limitTitle(
      cleaned
        .replace(/[，,。.!！?？；;：:、()[\]{}<>《》"“”'‘’`]/g, ' ')
        .replace(/\s+/g, '')
    );
  }

  const words = cleaned
    .replace(/[^a-zA-Z0-9+#._/-]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => !ENGLISH_STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 6);

  if (words.length === 0) return limitTitle(cleaned);
  return limitTitle(words.map(toTitleWord).join(' '));
}

function toTitleWord(value: string): string {
  if (/^[A-Z0-9+#._/-]+$/.test(value)) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function limitTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

function isGreetingOnly(value: string): boolean {
  const compact = value
    .toLowerCase()
    .replace(/[\s,.，。!！?？~～、;；:："'“”‘’`-]/g, '');

  return [
    'hi',
    'hello',
    'hey',
    'yo',
    '你好',
    '您好',
    '哈喽',
    '嗨',
    '在吗',
    '早上好',
    '下午好',
    '晚上好',
  ].includes(compact);
}

function meaningfulLength(value: string): number {
  return value.replace(/[\s,.，。!！?？~～、;；:："'“”‘’`-]/g, '').length;
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}
