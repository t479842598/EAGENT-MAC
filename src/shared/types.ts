// 主进程 / 渲染进程共享类型定义

export type SessionState =
  | 'idle'
  | 'booting'
  | 'ready'
  | 'sending'
  | 'awaiting'
  | 'parsing'
  | 'pending_approval'
  | 'executing'
  | 'feeding'
  | 'aborting'
  | 'error';

export type ToolName = 'shell' | 'screenshot' | 'upload' | 'mouse' | 'keyboard' | 'skill';

export type ToolStatus = 'pending_approval' | 'running' | 'success' | 'error' | 'denied';

export interface ToolCall {
  id: string;
  name: ToolName;
  raw: string;
  params: Record<string, unknown>;
  summary: string;
  status: ToolStatus;
  output?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  /** 命中的危险命令规则（强制二次确认） */
  dangerReason?: string;
}

export interface AttachmentRef {
  id: string;
  name: string;
  path: string;
  size: string;
  category: 'code' | 'pdf' | 'image' | 'text' | 'archive' | 'general';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time: string;
  attachments?: AttachmentRef[];
  thinking?: { steps: string[]; elapsedMs: number; live: boolean };
  toolCall?: ToolCall;
  images?: { path: string; name: string }[];
  error?: string;
}

export interface SessionStats {
  turns: number;
  toolCalls: number;
  state: SessionState;
  chromeConnected: boolean;
  loggedIn: boolean;
  lastLatencyMs?: number;
}

export type SessionEvent =
  | { type: 'state'; state: SessionState; detail?: string }
  | { type: 'user_msg'; message: ChatMessage }
  | { type: 'assistant_delta'; messageId: string; text: string }
  | { type: 'assistant_done'; message: ChatMessage }
  | { type: 'thinking'; messageId: string; steps: string[]; live: boolean }
  | { type: 'tool_call'; messageId: string; call: ToolCall }
  | { type: 'tool_update'; messageId: string; callId: string; patch: Partial<ToolCall> }
  | { type: 'tool_output'; messageId: string; callId: string; chunk: string }
  | { type: 'stats'; stats: SessionStats }
  | { type: 'error'; message: string; fatal?: boolean }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string };

export interface Settings {
  workDir: string;
  chromePath: string;
  debugPort: number;
  userDataDir: string;
  autoApprove: boolean;
  alwaysAllow: ToolName[];
  commandTimeoutMs: number;
  replyTimeoutMs: number;
  maxOutputChars: number;
  systemPromptExtra: string;
  theme: 'light' | 'dark' | 'system';
}

export interface CheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: { label: string; url?: string; command?: string };
}

export interface DoctorReport {
  results: CheckResult[];
  macinput: Record<string, unknown> | null;
}

export interface SessionMeta {
  id: string;
  title: string;
  updatedAt: string;
  isPinned: boolean;
  messages: ChatMessage[];
}
