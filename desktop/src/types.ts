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
  enabled: boolean;
  expiresAt: number | null;
  isDefault: boolean;
  isActive: boolean;
  preferredModel: string | null;
  preferredEffort: string | null;
  availableModels: Array<{ slug: string; name: string }>;
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
  details?: unknown;
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
  integration: { installed: boolean; port: number; activeModel: string | null; gatewayDefault: boolean };
  runtime: { running: boolean; port: number };
  autostart: { supported: boolean; enabled: boolean; development?: boolean };
  jev: {
    mode: 'off' | 'observe' | 'active';
    configured: boolean;
    model: string;
    minConfidence: number;
    contextProfile: 'economy' | 'balanced' | 'full';
    accountRouting: 'off' | 'observe' | 'active';
    maxChars: number;
    sampleRate: number;
    cacheTtlMs: number;
    allowedAccounts: string[] | null;
    allowedModels: string[] | null;
    keySource: 'secure-storage' | 'environment' | 'none';
    secureStorageAvailable: boolean;
  };
  codex: { available: boolean; version: string | null };
  gateway: { slug: string; displayName: string; activeAccountId: string | null };
  dataPath: string;
  catalogPath: string;
  logPath: string;
  logs: LogRecord[];
};

export type LauncherEvent =
  | { type: 'update-available'; version: string; url: string }
  | { type: 'update-downloaded'; version: string }
  | { type: 'update-progress'; percent: number; transferred: number; total: number }
  | { type: 'update-state'; state: string; message?: string }
  | { type: 'snapshot-invalidated' }
  | { type: 'open-add-account' }
  | { type: 'login-url'; accountId: string; url: string }
  | { type: 'login-state'; accountId: string; state: string }
  | { type: 'operation'; operation: Operation }
  | { type: 'log'; record: LogRecord };

export type CodexRouterDesktopApi = {
  snapshot(): Promise<Snapshot>;
  addAccount(label: string, authMode: 'local' | 'login'): Promise<Snapshot>;
  reauthenticateAccount(accountId: string): Promise<Snapshot>;
  removeAccount(accountId: string): Promise<Snapshot>;
  setDefaultAccount(accountId: string): Promise<Snapshot>;
  setAccountEnabled(accountId: string, enabled: boolean): Promise<Snapshot>;
  setAccountPreferences(accountId: string, preferences: { preferredModel?: string | null; preferredEffort?: string | null }): Promise<Snapshot>;
  syncCatalog(): Promise<Snapshot>;
  install(): Promise<Snapshot>;
  uninstall(): Promise<Snapshot>;
  startRouter(): Promise<Snapshot>;
  stopRouter(): Promise<Snapshot>;
  openCodex(): Promise<{ ok: boolean }>;
  setJevSettings(settings: { mode: 'off' | 'observe' | 'active'; minConfidence: number; contextProfile: 'economy' | 'balanced' | 'full'; accountRouting: 'off' | 'observe' | 'active'; maxChars: number; sampleRate: number; cacheTtlMs: number; allowedAccounts: string[] | null; allowedModels: string[] | null; apiKey?: string; clearApiKey?: boolean }): Promise<Snapshot>;
  setAutostart(enabled: boolean): Promise<{ supported: boolean; enabled: boolean }>;
  openExternal(url: string): Promise<void>;
  revealData(): Promise<{ ok: boolean }>;
  downloadUpdate(): Promise<{ ok: boolean }>;
  installUpdate(): Promise<{ ok: boolean }>;
  onEvent(callback: (event: LauncherEvent) => void): () => void;
};

declare global {
  interface Window {
    codexRouter?: CodexRouterDesktopApi;
  }
}
