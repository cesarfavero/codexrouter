export type UsageWindow = {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowSeconds: number | null;
  resetAfterSeconds: number | null;
  resetsAt: number | null;
};

export type AccountUsage = {
  status: 'available' | 'cooldown' | 'unknown';
  allowed: boolean | null;
  limitReached: boolean;
  cooldownUntil: number | null;
  reachedType: string | null;
  primary: UsageWindow | null;
  secondary: UsageWindow | null;
  spendControl: {
    reached: boolean;
    usedPercent: number | null;
    remainingPercent: number | null;
    resetsAt: number | null;
  } | null;
  checkedAt: string;
};

export type AccountSummary = {
  id: string;
  label: string;
  email: string | null;
  plan: string | null;
  connected: boolean;
  expiresAt: number | null;
  isDefault: boolean;
  isActive: boolean;
  preferredModel: string | null;
  modelCount: number;
  usage: AccountUsage | null;
  usageError: string | null;
  createdAt: string;
};

export type LogRecord = {
  id: string;
  level: 'info' | 'warning' | 'error' | string;
  message: string;
  at: string;
};

export type Operation = {
  name: string;
  status: 'running' | 'complete' | 'failed';
  message?: string;
  startedAt?: string;
  completedAt?: string;
};

export type Snapshot = {
  version: string;
  platform: string;
  packaged: boolean;
  accounts: AccountSummary[];
  defaultAccountId: string | null;
  integration: { installed: boolean; port: number };
  runtime: { running: boolean; port: number };
  autostart: { supported: boolean; enabled: boolean; development?: boolean };
  codex: { available: boolean; version: string | null };
  gateway: { slug: string; displayName: string; activeAccountId: string | null };
  dataPath: string;
  catalogPath: string;
  logs: LogRecord[];
};

export type LauncherEvent =
  | { type: 'snapshot-invalidated' }
  | { type: 'open-add-account' }
  | { type: 'login-url'; accountId: string; url: string }
  | { type: 'login-state'; accountId: string; state: string }
  | { type: 'operation'; operation: Operation }
  | { type: 'log'; record: LogRecord };

export type CodexRouterDesktopApi = {
  snapshot(): Promise<Snapshot>;
  addAccount(label: string): Promise<Snapshot>;
  reauthenticateAccount(accountId: string): Promise<Snapshot>;
  removeAccount(accountId: string): Promise<Snapshot>;
  setDefaultAccount(accountId: string): Promise<Snapshot>;
  syncCatalog(): Promise<Snapshot>;
  install(): Promise<Snapshot>;
  uninstall(): Promise<Snapshot>;
  startRouter(): Promise<Snapshot>;
  stopRouter(): Promise<Snapshot>;
  openCodex(): Promise<{ ok: boolean }>;
  setAutostart(enabled: boolean): Promise<{ supported: boolean; enabled: boolean }>;
  openExternal(url: string): Promise<void>;
  revealData(): Promise<{ ok: boolean }>;
  onEvent(callback: (event: LauncherEvent) => void): () => void;
};

declare global {
  interface Window {
    codexRouter?: CodexRouterDesktopApi;
  }
}
