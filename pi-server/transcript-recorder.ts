import { appendMessage, replaceMessage } from './persistence.js';
import type { ChatMessageData, TokenUsageData, ToolResultData, ToolUseData, WsServerMsg } from './types.js';

let recorderMessageCounter = 0;

export class TranscriptRecorder {
  private assistantBySession = new Map<string, ChatMessageData>();

  recordUserPrompt(sessionId: string, text: string): void {
    appendMessage(sessionId, {
      id: nextMessageId('user'),
      sessionId,
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: Date.now(),
    });
  }

  recordServerMessage(msg: WsServerMsg): void {
    switch (msg.type) {
      case 'thinking_start':
        this.ensureAssistant(msg.sessionId).thinking = { content: '', isExpanded: false };
        break;
      case 'thinking_delta': {
        const assistant = this.ensureAssistant(msg.sessionId);
        assistant.thinking = {
          content: `${assistant.thinking?.content ?? ''}${msg.delta}`,
          isExpanded: assistant.thinking?.isExpanded ?? false,
        };
        break;
      }
      case 'text_start': {
        const assistant = this.ensureAssistant(msg.sessionId, msg.messageId);
        assistant.id = msg.messageId;
        assistant.isStreaming = true;
        break;
      }
      case 'text_delta':
        this.appendAssistantText(msg.sessionId, msg.delta);
        break;
      case 'tool_use':
        this.recordToolUse(msg.sessionId, msg.toolCall);
        break;
      case 'tool_result':
        this.recordToolResult(msg.sessionId, msg.result);
        break;
      case 'message_complete':
        this.completeAssistant(msg.sessionId, msg.messageId, msg.usage);
        break;
    }
  }

  clearSession(sessionId: string): void {
    this.assistantBySession.delete(sessionId);
  }

  completeInterrupted(sessionId: string): void {
    const assistant = this.assistantBySession.get(sessionId);
    if (!assistant) return;

    assistant.isStreaming = false;
    if (assistant.content.length > 0 || assistant.thinking || (assistant.toolCalls?.length ?? 0) > 0) {
      replaceMessage(sessionId, assistant);
    }
    this.assistantBySession.delete(sessionId);
  }

  private ensureAssistant(sessionId: string, messageId?: string): ChatMessageData {
    const existing = this.assistantBySession.get(sessionId);
    if (existing) {
      if (messageId) existing.id = messageId;
      return existing;
    }

    const assistant: ChatMessageData = {
      id: messageId ?? nextMessageId('assistant'),
      sessionId,
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      toolCalls: [],
      isStreaming: true,
    };

    this.assistantBySession.set(sessionId, assistant);
    return assistant;
  }

  private appendAssistantText(sessionId: string, delta: string): void {
    const assistant = this.ensureAssistant(sessionId);
    const last = assistant.content[assistant.content.length - 1];

    if (last?.type === 'text') {
      last.text = `${last.text ?? ''}${delta}`;
    } else {
      assistant.content.push({ type: 'text', text: delta });
    }
  }

  private recordToolUse(sessionId: string, toolUse: ToolUseData): void {
    const assistant = this.ensureAssistant(sessionId);

    assistant.content.push({ type: 'tool_use', toolUse });
    assistant.toolCalls = [
      ...(assistant.toolCalls ?? []).filter((tool) => tool.id !== toolUse.id),
      { ...toolUse, status: 'running' },
    ];
  }

  private recordToolResult(sessionId: string, result: ToolResultData): void {
    const assistant = this.ensureAssistant(sessionId);

    assistant.content.push({ type: 'tool_result', toolResult: result });
    assistant.toolCalls = (assistant.toolCalls ?? []).map((tool) =>
      tool.id === result.toolCallId
        ? { ...tool, status: result.isError ? 'error' : 'success', result }
        : tool
    );
  }

  private completeAssistant(sessionId: string, messageId: string, usage: TokenUsageData): void {
    const assistant = this.ensureAssistant(sessionId, messageId);
    assistant.id = messageId;
    assistant.usage = usage;
    assistant.isStreaming = false;
    replaceMessage(sessionId, assistant);
    this.assistantBySession.delete(sessionId);
  }
}

function nextMessageId(prefix: string): string {
  recorderMessageCounter += 1;
  return `${prefix}-${Date.now()}-${recorderMessageCounter}`;
}
