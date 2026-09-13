// UI structure and interaction language adapted from the MIT-licensed
// miuuyy/codex-chatgpt-web launcher. Product flows are CodexRouter-specific.
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import type { AccountSummary, LauncherEvent, LogRecord, Operation, Snapshot } from './types';

const api = window.codexRouter;
type Surface = 'accounts' | 'setup' | 'activity' | 'settings';
const transition = { duration: 0.26, ease: [0.16, 1, 0.3, 1] } as const;

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [surface, setSurface] = useState<Surface>('accounts');
  const [operation, setOperation] = useState<Operation | null>(null);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [login, setLogin] = useState<{ accountId?: string; state?: string; url?: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    const next = await api.snapshot();
    setSnapshot(next);
    setLogs(next.logs);
  }, []);

  useEffect(() => {
    if (!api) return;
    void refresh().catch(cause => setError(messageOf(cause)));
    return api.onEvent((event: LauncherEvent) => {
      if (event.type === 'snapshot-invalidated') void refresh().catch(cause => setError(messageOf(cause)));
      if (event.type === 'open-add-account') setAddOpen(true);
      if (event.type === 'operation') setOperation(event.operation);
      if (event.type === 'log') setLogs(current => [...current.slice(-249), event.record]);
      if (event.type === 'login-state') setLogin(current => ({ ...current, accountId: event.accountId, state: event.state }));
      if (event.type === 'login-url') setLogin(current => ({ ...current, accountId: event.accountId, url: event.url }));
    });
  }, [refresh]);

  if (!api) return <FatalState title="Desktop bridge unavailable" body="CodexRouter could not initialize its secure Electron bridge." />;
  if (!snapshot) return <LoadingState />;

  const needsSetup = snapshot.accounts.length > 0 && (!snapshot.integration.installed || !snapshot.runtime.running);

  return (
    <div className="app-root">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark />
          <div>
            <strong>CodexRouter</strong>
            <span>v{snapshot.version}</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="CodexRouter">
          <NavGroup label="Workspace">
            <NavItem active={surface === 'accounts'} icon="accounts" label="Accounts" onClick={() => setSurface('accounts')} badge={snapshot.accounts.length ? String(snapshot.accounts.length) : undefined} />
          </NavGroup>
          <NavGroup label="Configuration">
            <NavItem active={surface === 'setup'} icon="setup" label="Setup" onClick={() => setSurface('setup')} dot={needsSetup ? 'attention' : snapshot.integration.installed ? 'success' : undefined} />
            <NavItem active={surface === 'settings'} icon="settings" label="Settings" onClick={() => setSurface('settings')} />
          </NavGroup>
          <NavGroup label="Runtime">
            <NavItem active={surface === 'activity'} icon="activity" label="Activity" onClick={() => setSurface('activity')} dot={snapshot.runtime.running ? 'success' : undefined} />
          </NavGroup>
        </nav>

        <div className="sidebar-footer">
          <div className="runtime-mini">
            <StatusDot tone={snapshot.runtime.running ? 'success' : 'neutral'} />
            <div>
              <strong>{snapshot.runtime.running ? 'Router running' : 'Router stopped'}</strong>
              <span>127.0.0.1:{snapshot.runtime.port}</span>
            </div>
          </div>
          <button className="sidebar-codex" onClick={() => void run(() => api.openCodex(), setError)} type="button">
            <Icon name="codex" />
            Open Codex
            <Icon name="external" />
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="titlebar draggable">
          <div />
          <div className="titlebar-status no-drag">
            <StatusDot tone={snapshot.codex.available ? 'success' : 'error'} />
            <span>{snapshot.codex.available ? snapshot.codex.version || 'Codex available' : 'Codex not found'}</span>
          </div>
        </header>

        <div className="content-scroll">
          <AnimatePresence mode="wait">
            <motion.section
              animate={{ opacity: 1, y: 0 }}
              className="surface"
              exit={{ opacity: 0, y: -5 }}
              initial={{ opacity: 0, y: 7 }}
              key={surface}
              transition={transition}
            >
              {surface === 'accounts' ? (
                <AccountsSurface
                  snapshot={snapshot}
                  onAdd={() => setAddOpen(true)}
                  onRefresh={refresh}
                  setError={setError}
                  setLogin={setLogin}
                />
              ) : null}
              {surface === 'setup' ? <SetupSurface snapshot={snapshot} onRefresh={refresh} setError={setError} /> : null}
              {surface === 'activity' ? <ActivitySurface logs={logs} snapshot={snapshot} /> : null}
              {surface === 'settings' ? <SettingsSurface snapshot={snapshot} onRefresh={refresh} setError={setError} /> : null}
            </motion.section>
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>{addOpen ? <AddAccountModal login={login} onClose={() => { setAddOpen(false); setLogin(null); }} onComplete={async () => { setAddOpen(false); setLogin(null); await refresh(); }} setError={setError} /> : null}</AnimatePresence>
      <AnimatePresence>{operation?.status === 'running' ? <OperationPill operation={operation} /> : null}</AnimatePresence>
      <AnimatePresence>{error ? <ErrorToast message={error} onDismiss={() => setError(null)} /> : null}</AnimatePresence>
    </div>
  );
}

function AccountsSurface({ snapshot, onAdd, onRefresh, setError, setLogin }: {
  snapshot: Snapshot;
  onAdd: () => void;
  onRefresh: () => Promise<void>;
  setError: (message: string | null) => void;
  setLogin: (value: { accountId?: string; state?: string; url?: string } | null) => void;
}) {
  return (
    <>
      <SurfaceHeader
        eyebrow="Accounts"
        title="ChatGPT accounts inside Codex"
        body="Each account keeps its own official Codex login. The model picker gets an account-qualified alias, so choosing a model also chooses the account."
        actions={<PrimaryButton icon="plus" onClick={onAdd}>Add Account</PrimaryButton>}
      />

      {snapshot.accounts.length === 0 ? (
        <EmptyAccounts onAdd={onAdd} />
      ) : (
        <div className="account-list">
          {snapshot.accounts.map(account => (
            <AccountRow
              account={account}
              key={account.id}
              onDefault={async () => {
                try { await api!.setDefaultAccount(account.id); await onRefresh(); } catch (cause) { setError(messageOf(cause)); }
              }}
              onReauth={async () => {
                setLogin({ accountId: account.id, state: 'starting' });
                try { await api!.reauthenticateAccount(account.id); await onRefresh(); }
                catch (cause) { setError(messageOf(cause)); }
                finally { setLogin(null); }
              }}
              onRemove={async () => {
                if (!window.confirm(`Remove ${account.label}? The isolated local Codex profile will be deleted after Codex logout.`)) return;
                try { await api!.removeAccount(account.id); await onRefresh(); } catch (cause) { setError(messageOf(cause)); }
              }}
            />
          ))}
        </div>
      )}

      <div className="section-divider" />
      <div className="compact-actions">
        <SecondaryButton icon="refresh" onClick={async () => {
          try { await api!.syncCatalog(); await onRefresh(); } catch (cause) { setError(messageOf(cause)); }
        }}>Sync models</SecondaryButton>
        <p>Catalog sync asks each isolated Codex profile for its native model catalog and rebuilds the aliases.</p>
      </div>
    </>
  );
}

function AccountRow({ account, onDefault, onReauth, onRemove }: {
  account: AccountSummary;
  onDefault: () => void;
  onReauth: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="account-row">
      <div className="account-avatar">{initials(account.label)}</div>
      <div className="account-identity">
        <div className="account-title-line">
          <strong>{account.label}</strong>
          {account.isDefault ? <span className="soft-badge">Default</span> : null}
          {account.plan ? <span className="plan-badge">{formatPlan(account.plan)}</span> : null}
        </div>
        <span>{account.email || 'Email becomes available after login'}</span>
      </div>
      <div className="account-models">
        <strong>{account.modelCount}</strong>
        <span>models</span>
      </div>
      <div className="account-status">
        <StatusDot tone={account.connected ? 'success' : 'error'} />
        <span>{account.connected ? 'Connected' : 'Needs login'}</span>
      </div>
      <div className="account-actions">
        {!account.isDefault ? <IconButton icon="check" label="Make default" onClick={onDefault} /> : null}
        <IconButton icon="refresh" label="Re-authenticate" onClick={onReauth} />
        <IconButton danger icon="trash" label="Remove" onClick={onRemove} />
      </div>
    </div>
  );
}

function EmptyAccounts({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-mark"><Icon name="accounts" /></div>
      <h2>No accounts connected</h2>
      <p>Add your first ChatGPT account. CodexRouter creates an isolated <code>CODEX_HOME</code> and lets the official Codex login own the OAuth flow.</p>
      <PrimaryButton icon="plus" onClick={onAdd}>Add first account</PrimaryButton>
    </div>
  );
}

function SetupSurface({ snapshot, onRefresh, setError }: { snapshot: Snapshot; onRefresh: () => Promise<void>; setError: (message: string | null) => void }) {
  const connected = snapshot.accounts.filter(account => account.connected).length;
  const steps = [
    { done: connected > 0, title: 'Connect accounts', body: `${connected} of ${snapshot.accounts.length} configured accounts are authenticated.` },
    { done: snapshot.accounts.some(account => account.modelCount > 0), title: 'Build model aliases', body: 'Read each account model catalog and append “Model · Account” aliases.' },
    { done: snapshot.integration.installed, title: 'Install Codex integration', body: 'Manage openai_base_url and model_catalog_json transactionally in the main Codex config.' },
    { done: snapshot.runtime.running, title: 'Run in the background', body: `Keep the router available on 127.0.0.1:${snapshot.runtime.port}.` },
  ];

  return (
    <>
      <SurfaceHeader eyebrow="Setup" title="One-time setup" body="The CLI remains available for recovery, but the normal setup path lives here." />
      <div className="setup-list">
        {steps.map((step, index) => <SetupStep index={index + 1} key={step.title} {...step} />)}
      </div>
      <div className="setup-controls">
        <SecondaryButton icon="refresh" disabled={!snapshot.accounts.length} onClick={() => void doAndRefresh(() => api!.syncCatalog(), onRefresh, setError)}>Sync catalog</SecondaryButton>
        {!snapshot.integration.installed ? (
          <PrimaryButton icon="power" disabled={!snapshot.accounts.length} onClick={() => void doAndRefresh(() => api!.install(), onRefresh, setError)}>Install & start</PrimaryButton>
        ) : snapshot.runtime.running ? (
          <SecondaryButton icon="stop" onClick={() => void doAndRefresh(() => api!.stopRouter(), onRefresh, setError)}>Stop router</SecondaryButton>
        ) : (
          <PrimaryButton icon="play" onClick={() => void doAndRefresh(() => api!.startRouter(), onRefresh, setError)}>Start router</PrimaryButton>
        )}
        {snapshot.integration.installed ? <SecondaryButton onClick={() => void doAndRefresh(() => api!.uninstall(), onRefresh, setError)}>Uninstall integration</SecondaryButton> : null}
      </div>

      <div className={`ready-panel ${snapshot.integration.installed && snapshot.runtime.running ? 'is-ready' : ''}`}>
        <div className="ready-icon"><Icon name={snapshot.integration.installed && snapshot.runtime.running ? 'check' : 'setup'} /></div>
        <div>
          <strong>{snapshot.integration.installed && snapshot.runtime.running ? 'Ready for Codex' : 'Finish setup to expose account models'}</strong>
          <p>{snapshot.integration.installed && snapshot.runtime.running ? 'Restart/open Codex and choose an account-qualified model from the native picker.' : 'Your accounts stay isolated even before the global integration is installed.'}</p>
        </div>
        <PrimaryButton icon="codex" disabled={!snapshot.integration.installed || !snapshot.runtime.running} onClick={() => void run(() => api!.openCodex(), setError)}>Open Codex</PrimaryButton>
      </div>
    </>
  );
}

function SetupStep({ index, done, title, body }: { index: number; done: boolean; title: string; body: string }) {
  return (
    <div className="setup-step">
      <span className={`step-index ${done ? 'is-done' : ''}`}>{done ? <Icon name="check" /> : index}</span>
      <div><strong>{title}</strong><p>{body}</p></div>
      <span className={done ? 'step-state success' : 'step-state'}>{done ? 'Complete' : 'Pending'}</span>
    </div>
  );
}

function ActivitySurface({ logs, snapshot }: { logs: LogRecord[]; snapshot: Snapshot }) {
  return (
    <>
      <SurfaceHeader eyebrow="Runtime" title="Activity" body="Operational events only. Authentication tokens, cookies and raw auth files are never written to this log." />
      <div className="metrics-row">
        <Metric label="Runtime" value={snapshot.runtime.running ? 'Running' : 'Stopped'} tone={snapshot.runtime.running ? 'success' : 'neutral'} />
        <Metric label="Accounts" value={`${snapshot.accounts.filter(account => account.connected).length}/${snapshot.accounts.length}`} />
        <Metric label="Integration" value={snapshot.integration.installed ? 'Installed' : 'Not installed'} />
      </div>
      <div className="log-view">
        <div className="log-head"><span>Recent events</span><span>{logs.length}</span></div>
        {logs.length ? [...logs].reverse().map(log => (
          <div className="log-row" key={log.id}>
            <span className={`log-dot ${log.level}`} />
            <time>{new Date(log.at).toLocaleTimeString()}</time>
            <span>{log.message}</span>
          </div>
        )) : <div className="log-empty">No runtime events yet.</div>}
      </div>
    </>
  );
}

function SettingsSurface({ snapshot, onRefresh, setError }: { snapshot: Snapshot; onRefresh: () => Promise<void>; setError: (message: string | null) => void }) {
  return (
    <>
      <SurfaceHeader eyebrow="Settings" title="Desktop behavior" body="CodexRouter stays in the menu bar so the local router can remain available without keeping a window open." />
      <div className="settings-list">
        <SettingRow title="Launch at login" description={snapshot.autostart.supported ? 'Start CodexRouter hidden when you sign in to macOS.' : 'Available in the packaged desktop app.'}>
          <Toggle checked={snapshot.autostart.enabled} disabled={!snapshot.autostart.supported} onChange={async checked => {
            try { await api!.setAutostart(checked); await onRefresh(); } catch (cause) { setError(messageOf(cause)); }
          }} />
        </SettingRow>
        <SettingRow title="Router endpoint" description="Loopback only. It is not exposed to the network."><code>127.0.0.1:{snapshot.runtime.port}</code></SettingRow>
        <SettingRow title="Codex" description={snapshot.codex.available ? 'Detected on this Mac.' : 'Install the Codex CLI before adding accounts.'}><span className="value-text">{snapshot.codex.version || 'Not found'}</span></SettingRow>
        <SettingRow title="Local data" description="Account metadata, isolated CODEX_HOME profiles and the generated catalog."><SecondaryButton icon="folder" onClick={() => void run(() => api!.revealData(), setError)}>Reveal</SecondaryButton></SettingRow>
      </div>

      <div className="credits-panel">
        <Icon name="shield" />
        <div>
          <strong>Open-source attribution</strong>
          <p>The desktop UI/UX and launcher patterns are adapted from <code>miuuyy/codex-chatgpt-web</code> under the MIT License. CodexRouter keeps the original notice in <code>LICENSES/</code> and documents adapted work in <code>THIRD_PARTY_NOTICES.md</code>.</p>
        </div>
        <SecondaryButton icon="external" onClick={() => void api!.openExternal('https://github.com/miuuyy/codex-chatgpt-web')}>Upstream</SecondaryButton>
      </div>
    </>
  );
}

function AddAccountModal({ login, onClose, onComplete, setError }: {
  login: { accountId?: string; state?: string; url?: string } | null;
  onClose: () => void;
  onComplete: () => Promise<void>;
  setError: (message: string | null) => void;
}) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const waiting = busy || Boolean(login?.state);

  const submit = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api!.addAccount(label.trim());
      await onComplete();
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
    }
  };

  return (
    <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget && !waiting) onClose(); }}>
      <motion.div animate={{ opacity: 1, scale: 1, y: 0 }} className="modal" exit={{ opacity: 0, scale: 0.98, y: 4 }} initial={{ opacity: 0, scale: 0.98, y: 8 }} transition={transition}>
        <div className="modal-kicker">Add ChatGPT account</div>
        {!waiting ? (
          <>
            <h2>Name this account</h2>
            <p>This label is what appears in Codex, for example <strong>GPT-5.6 Sol · Cesar</strong>. Authentication itself is handled by the official Codex login flow.</p>
            <label className="field-label" htmlFor="account-label">Account label</label>
            <input autoFocus id="account-label" maxLength={80} onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submit(); }} placeholder="Cesar" value={label} />
            <div className="modal-security"><Icon name="shield"/><span>No password, token or ChatGPT cookie is collected by CodexRouter.</span></div>
            <div className="modal-actions"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton disabled={!label.trim()} onClick={() => void submit()}>Continue with Codex</PrimaryButton></div>
          </>
        ) : (
          <>
            <h2>{login?.state === 'authenticated' ? 'Account connected' : 'Finish sign in'}</h2>
            <p>{login?.state === 'authenticated' ? 'Codex completed authentication. We are reading the account model catalog now.' : 'Codex started its local OAuth callback server. Complete the official OpenAI sign-in in your browser.'}</p>
            <div className="login-progress">
              <div className="spinner" />
              <div><strong>{loginStateLabel(login?.state)}</strong><span>You can return here after the browser confirms the login.</span></div>
            </div>
            {login?.url ? <PrimaryButton icon="external" onClick={() => void api!.openExternal(login.url!)}>Open sign-in page</PrimaryButton> : null}
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function SurfaceHeader({ eyebrow, title, body, actions }: { eyebrow: string; title: string; body: string; actions?: ReactNode }) {
  return <header className="surface-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{body}</p></div>{actions ? <div className="surface-actions">{actions}</div> : null}</header>;
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="nav-group"><span>{label}</span>{children}</div>;
}

function NavItem({ active, icon, label, onClick, badge, dot }: { active: boolean; icon: IconName; label: string; onClick: () => void; badge?: string; dot?: 'success' | 'attention' }) {
  return <button className={`nav-item ${active ? 'is-active' : ''}`} onClick={onClick} type="button"><Icon name={icon}/><span>{label}</span>{badge ? <em>{badge}</em> : null}{dot ? <StatusDot tone={dot === 'success' ? 'success' : 'warning'} /> : null}</button>;
}

function BrandMark() {
  return <div className="brand-mark"><span/><span/></div>;
}

function StatusDot({ tone }: { tone: 'success' | 'warning' | 'error' | 'neutral' }) {
  return <span className={`status-dot ${tone}`} />;
}

function PrimaryButton({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName }) {
  return <button className="button primary" type="button" {...props}>{icon ? <Icon name={icon}/> : null}<span>{children}</span></button>;
}

function SecondaryButton({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName }) {
  return <button className="button secondary" type="button" {...props}>{icon ? <Icon name={icon}/> : null}<span>{children}</span></button>;
}

function IconButton({ icon, label, danger, onClick }: { icon: IconName; label: string; danger?: boolean; onClick: () => void }) {
  return <button aria-label={label} className={`icon-button ${danger ? 'danger' : ''}`} onClick={onClick} title={label} type="button"><Icon name={icon}/></button>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'neutral' }) {
  return <div className="metric"><span>{label}</span><strong className={tone === 'success' ? 'success-text' : ''}>{value}</strong></div>;
}

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div><div className="setting-value">{children}</div></div>;
}

function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <button aria-checked={checked} className={`toggle ${checked ? 'is-on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)} role="switch" type="button"><span/></button>;
}

function OperationPill({ operation }: { operation: Operation }) {
  return <motion.div animate={{ opacity: 1, y: 0 }} className="operation-pill" exit={{ opacity: 0, y: 8 }} initial={{ opacity: 0, y: 8 }}><div className="spinner small"/><span>{operation.name}</span></motion.div>;
}

function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return <motion.div animate={{ opacity: 1, y: 0 }} className="error-toast" exit={{ opacity: 0, y: 8 }} initial={{ opacity: 0, y: 8 }}><span>{message}</span><button onClick={onDismiss} type="button">Dismiss</button></motion.div>;
}

function LoadingState() {
  return <div className="center-state"><BrandMark/><div className="spinner"/><span>Loading CodexRouter…</span></div>;
}

function FatalState({ title, body }: { title: string; body: string }) {
  return <div className="center-state"><h1>{title}</h1><p>{body}</p></div>;
}

function formatPlan(plan: string) {
  const normalized = String(plan).replace(/[_-]+/g, ' ');
  return normalized.replace(/\b\w/g, char => char.toUpperCase());
}

function initials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'A';
}

function loginStateLabel(state?: string) {
  if (state === 'starting') return 'Starting Codex login…';
  if (state === 'waiting-for-browser') return 'Waiting for browser authentication…';
  if (state === 'authenticated') return 'Authentication complete';
  return 'Waiting for Codex…';
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function run(work: () => Promise<unknown>, setError: (message: string | null) => void) {
  setError(null);
  try { await work(); } catch (cause) { setError(messageOf(cause)); }
}

async function doAndRefresh(work: () => Promise<unknown>, refresh: () => Promise<void>, setError: (message: string | null) => void) {
  await run(async () => { await work(); await refresh(); }, setError);
}
