// UI structure and interaction language adapted from the MIT-licensed
// miuuyy/codex-chatgpt-web launcher. Product flows are CodexRouter-specific.
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
  const activeAccount = snapshot.accounts.find(account => account.isActive) ?? null;

  return (
    <div className="app-root">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandMark />
          <div><strong>CodexRouter</strong><span>v{snapshot.version}</span></div>
        </div>

        <nav className="sidebar-nav" aria-label="CodexRouter">
          <NavGroup label="Workspace">
            <NavItem active={surface === 'accounts'} icon="accounts" label="Gateway" onClick={() => setSurface('accounts')} badge={snapshot.accounts.length ? String(snapshot.accounts.length) : undefined} />
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
              <strong>{snapshot.runtime.running ? 'Gateway running' : 'Gateway stopped'}</strong>
              <span>{activeAccount ? `${activeAccount.label} · ${activeAccount.preferredModel || 'sync model'}` : 'No active account'}</span>
            </div>
          </div>
          <button className="sidebar-codex" onClick={() => void run(() => api.openCodex(), setError)} type="button">
            <Icon name="codex" />Open Codex<Icon name="external" />
          </button>
        </div>
      </aside>

      <main className="main-shell">
        <header className="titlebar draggable">
          <div />
          <div className="titlebar-status no-drag">
            <StatusDot tone={snapshot.codex.available ? 'success' : 'error'} />
            <span>{snapshot.codex.available ? `${snapshot.gateway.displayName} · ${activeAccount?.label || 'no account'}` : 'Codex not found'}</span>
          </div>
        </header>

        <div className="content-scroll">
          <AnimatePresence mode="wait">
            <motion.section animate={{ opacity: 1, y: 0 }} className="surface" exit={{ opacity: 0, y: -5 }} initial={{ opacity: 0, y: 7 }} key={surface} transition={transition}>
              {surface === 'accounts' ? <AccountsSurface snapshot={snapshot} onAdd={() => setAddOpen(true)} onRefresh={refresh} setError={setError} setLogin={setLogin} /> : null}
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
        eyebrow="Gateway"
        title="One model in Codex. Accounts live here."
        body={`Codex only sees “${snapshot.gateway.displayName}”. This app controls which account and native Codex model the gateway uses.`}
        actions={<PrimaryButton icon="plus" onClick={onAdd}>Add Account</PrimaryButton>}
      />

      {snapshot.accounts.length === 0 ? <EmptyAccounts onAdd={onAdd} /> : (
        <div className="account-list">
          {snapshot.accounts.map(account => (
            <AccountRow
              account={account}
              key={account.id}
              onActivate={async () => {
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
        }}>Refresh gateway</SecondaryButton>
        <p>Refresh reads the real Codex catalog for each account and rebuilds the single managed model.</p>
      </div>
    </>
  );
}

function AccountRow({ account, onActivate, onReauth, onRemove }: {
  account: AccountSummary;
  onActivate: () => void;
  onReauth: () => void;
  onRemove: () => void;
}) {
  const cooldown = account.usage?.status === 'cooldown';
  const statusTone = !account.connected ? 'error' : cooldown ? 'warning' : 'success';
  const statusText = !account.connected ? 'Needs login' : cooldown ? `Cooldown${account.usage?.cooldownUntil ? ` · ${formatReset(account.usage.cooldownUntil)}` : ''}` : account.isActive ? 'Active' : 'Ready';
  const remaining = account.usage?.primary?.remainingPercent;
  const usageValue = remaining == null ? '—' : `${Math.round(remaining)}%`;
  const usageCaption = account.usageError ? 'usage unavailable' : cooldown ? 'until reset' : 'remaining';

  return (
    <div className="account-row">
      <div className="account-avatar">{initials(account.label)}</div>
      <div className="account-identity">
        <div className="account-title-line">
          <strong>{account.label}</strong>
          {account.isActive ? <span className="soft-badge">Active</span> : null}
          {account.plan ? <span className="plan-badge">{formatPlan(account.plan)}</span> : null}
        </div>
          <span>{account.email || 'Email becomes available after login'}{account.preferredModel ? ` · ${account.preferredModel}` : ''}{account.preferredEffort ? ` · ${account.preferredEffort} effort` : ''}</span>
      </div>
      <div className="account-models"><strong>{usageValue}</strong><span>{usageCaption}</span></div>
      <div className="account-status"><StatusDot tone={statusTone} /><span>{statusText}</span></div>
      <div className="account-actions">
        {!account.isActive ? <IconButton icon="check" label="Use for gateway" onClick={onActivate} /> : null}
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
  const active = snapshot.accounts.find(account => account.isActive);
  const steps = [
    { done: connected > 0, title: 'Connect accounts', body: `${connected} of ${snapshot.accounts.length} configured accounts are authenticated.` },
    { done: Boolean(active?.preferredModel), title: 'Build gateway model', body: active?.preferredModel ? `CodexRouter currently resolves to ${active.preferredModel} on ${active.label}.` : 'Read the active account model catalog and create one CodexRouter entry.' },
    { done: snapshot.integration.installed, title: 'Install Codex integration', body: 'Manage openai_base_url and model_catalog_json transactionally in the main Codex config.' },
    { done: snapshot.runtime.running, title: 'Run in the background', body: `Keep the gateway available on 127.0.0.1:${snapshot.runtime.port}.` },
  ];

  return (
    <>
      <SurfaceHeader eyebrow="Setup" title="One-time setup" body="Connect accounts here once. Codex only needs the single CodexRouter model." />
      <div className="setup-list">{steps.map((step, index) => <SetupStep index={index + 1} key={step.title} {...step} />)}</div>
      <div className="setup-controls">
        <SecondaryButton icon="refresh" disabled={!snapshot.accounts.length} onClick={() => void doAndRefresh(() => api!.syncCatalog(), onRefresh, setError)}>Refresh gateway</SecondaryButton>
        {!snapshot.integration.installed ? (
          <PrimaryButton icon="power" disabled={!snapshot.accounts.length} onClick={() => void doAndRefresh(() => api!.install(), onRefresh, setError)}>Install & start</PrimaryButton>
        ) : snapshot.runtime.running ? (
          <SecondaryButton icon="stop" onClick={() => void doAndRefresh(() => api!.stopRouter(), onRefresh, setError)}>Stop gateway</SecondaryButton>
        ) : (
          <PrimaryButton icon="play" onClick={() => void doAndRefresh(() => api!.startRouter(), onRefresh, setError)}>Start gateway</PrimaryButton>
        )}
        {snapshot.integration.installed ? <SecondaryButton onClick={() => void doAndRefresh(() => api!.uninstall(), onRefresh, setError)}>Uninstall integration</SecondaryButton> : null}
      </div>

      <div className={`ready-panel ${snapshot.integration.installed && snapshot.runtime.running ? 'is-ready' : ''}`}>
        <div className="ready-icon"><Icon name={snapshot.integration.installed && snapshot.runtime.running ? 'check' : 'setup'} /></div>
        <div>
          <strong>{snapshot.integration.installed && snapshot.runtime.running ? 'Ready for Codex' : 'Finish setup to expose the gateway'}</strong>
          <p>{snapshot.integration.installed && snapshot.runtime.running ? `Open Codex and choose “${snapshot.gateway.displayName}”. Account and native model stay managed here.` : 'Your account profiles remain isolated before the global integration is installed.'}</p>
        </div>
        <PrimaryButton icon="codex" disabled={!snapshot.integration.installed || !snapshot.runtime.running} onClick={() => void run(() => api!.openCodex(), setError)}>Open Codex</PrimaryButton>
      </div>
    </>
  );
}

function SetupStep({ index, done, title, body }: { index: number; done: boolean; title: string; body: string }) {
  return <div className="setup-step"><span className={`step-index ${done ? 'is-done' : ''}`}>{done ? <Icon name="check" /> : index}</span><div><strong>{title}</strong><p>{body}</p></div><span className={done ? 'step-state success' : 'step-state'}>{done ? 'Complete' : 'Pending'}</span></div>;
}

function ActivitySurface({ logs, snapshot }: { logs: LogRecord[]; snapshot: Snapshot }) {
  const active = snapshot.accounts.find(account => account.isActive);
  return (
    <>
      <SurfaceHeader eyebrow="Runtime" title="Activity" body="Operational events only. Authentication tokens, cookies and raw auth files are never written to this log." />
      <div className="metrics-row">
        <Metric label="Gateway" value={snapshot.runtime.running ? 'Running' : 'Stopped'} tone={snapshot.runtime.running ? 'success' : 'neutral'} />
        <Metric label="Active account" value={active?.label || 'None'} />
        <Metric label="Usage" value={active?.usage?.primary?.remainingPercent == null ? 'Unknown' : `${Math.round(active.usage.primary.remainingPercent)}% left`} />
      </div>
      <div className="log-view">
        <div className="log-head"><span>Recent events</span><span>{logs.length}</span></div>
        {logs.length ? [...logs].reverse().map(log => <div className="log-row" key={log.id}><span className={`log-dot ${log.level}`} /><time>{new Date(log.at).toLocaleTimeString()}</time><span>{log.message}</span></div>) : <div className="log-empty">No runtime events yet.</div>}
      </div>
    </>
  );
}

function SettingsSurface({ snapshot, onRefresh, setError }: { snapshot: Snapshot; onRefresh: () => Promise<void>; setError: (message: string | null) => void }) {
  const active = snapshot.accounts.find(account => account.isActive) ?? null;
  const [model, setModel] = useState(active?.preferredModel ?? '');
  const [effort, setEffort] = useState(active?.preferredEffort ?? 'medium');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setModel(active?.preferredModel ?? '');
    setEffort(active?.preferredEffort ?? 'medium');
  }, [active?.id, active?.preferredModel, active?.preferredEffort]);

  const savePreferences = async () => {
    if (!active || saving) return;
    setSaving(true);
    try { await api!.setAccountPreferences(active.id, { preferredModel: model || null, preferredEffort: effort || null }); await onRefresh(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setSaving(false); }
  };

  return (
    <>
      <SurfaceHeader eyebrow="Settings" title="Models and desktop behavior" body="Choose the native Codex model and default reasoning effort used by the active gateway account." />
      <div className="settings-list">
        <SettingRow title="Default native model" description={active ? `Model used behind CodexRouter for ${active.label}. Refresh the gateway catalog to discover new models.` : 'Connect an account first.'}>
          <select aria-label="Default native model" disabled={!active || !active.availableModels.length || saving} onChange={event => setModel(event.target.value)} value={model}>
            {!active?.availableModels.length ? <option value="">Refresh catalog first</option> : null}
            {active?.availableModels.map(item => <option key={item.slug} value={item.slug}>{item.name} · {item.slug}</option>)}
          </select>
        </SettingRow>
        <SettingRow title="Default reasoning effort" description="Applied only when a request does not already specify reasoning.effort.">
          <select aria-label="Default reasoning effort" disabled={!active || saving} onChange={event => setEffort(event.target.value)} value={effort}>
            {['minimal', 'low', 'medium', 'high', 'xhigh'].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </SettingRow>
        <div className="settings-save"><PrimaryButton disabled={!active || saving || (model === (active?.preferredModel ?? '') && effort === (active?.preferredEffort ?? 'medium'))} onClick={() => void savePreferences()}> {saving ? 'Saving…' : 'Save model defaults'}</PrimaryButton></div>
        <SettingRow title="Launch at login" description={snapshot.autostart.supported ? 'Start CodexRouter hidden when you sign in to macOS.' : 'Available in the packaged desktop app.'}>
          <Toggle checked={snapshot.autostart.enabled} disabled={!snapshot.autostart.supported} onChange={async checked => { try { await api!.setAutostart(checked); await onRefresh(); } catch (cause) { setError(messageOf(cause)); } }} />
        </SettingRow>
        <SettingRow title="Model shown in Codex" description="All account/model routing happens behind this one managed row."><code>{snapshot.gateway.displayName}</code></SettingRow>
        <SettingRow title="Router endpoint" description="Loopback only. It is not exposed to the network."><code>127.0.0.1:{snapshot.runtime.port}</code></SettingRow>
        <SettingRow title="Codex" description={snapshot.codex.available ? 'Detected on this Mac.' : 'Install the Codex CLI before adding accounts.'}><span className="value-text">{snapshot.codex.version || 'Not found'}</span></SettingRow>
        <SettingRow title="Local data" description="Account metadata, isolated CODEX_HOME profiles and the generated gateway catalog."><SecondaryButton icon="folder" onClick={() => void run(() => api!.revealData(), setError)}>Reveal</SecondaryButton></SettingRow>
      </div>
      <div className="credits-panel"><Icon name="shield" /><div><strong>Open-source attribution</strong><p>The desktop UI/UX and launcher patterns are adapted from <code>miuuyy/codex-chatgpt-web</code> under the MIT License. The original notice remains in <code>LICENSES/</code>.</p></div><SecondaryButton icon="external" onClick={() => void api!.openExternal('https://github.com/miuuyy/codex-chatgpt-web')}>Upstream</SecondaryButton></div>
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
    try { await api!.addAccount(label.trim()); await onComplete(); }
    catch (cause) { setError(messageOf(cause)); setBusy(false); }
  };

  return (
    <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget && !waiting) onClose(); }}>
      <motion.div animate={{ opacity: 1, scale: 1, y: 0 }} className="modal" exit={{ opacity: 0, scale: 0.98, y: 4 }} initial={{ opacity: 0, scale: 0.98, y: 8 }} transition={transition}>
        <div className="modal-kicker">Add ChatGPT account</div>
        {!waiting ? <>
          <h2>Name this account</h2>
          <p>The label is only used inside CodexRouter to identify the account behind the single gateway model. Authentication is handled by the official Codex login flow.</p>
          <label className="field-label" htmlFor="account-label">Account label</label>
          <input autoFocus id="account-label" maxLength={80} onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submit(); }} placeholder="Cesar" value={label} />
          <div className="modal-security"><Icon name="shield"/><span>No password, token or ChatGPT cookie is collected by CodexRouter.</span></div>
          <div className="modal-actions"><SecondaryButton onClick={onClose}>Cancel</SecondaryButton><PrimaryButton disabled={!label.trim()} onClick={() => void submit()}>Continue with Codex</PrimaryButton></div>
        </> : <>
          <h2>{login?.state === 'authenticated' ? 'Account connected' : 'Finish sign in'}</h2>
          <p>{login?.state === 'authenticated' ? 'Codex completed authentication. We are reading the account model catalog now.' : 'Codex started its local OAuth callback server. Complete the official OpenAI sign-in in your browser.'}</p>
          <div className="login-progress"><div className="spinner" /><div><strong>{loginStateLabel(login?.state)}</strong><span>You can return here after the browser confirms the login.</span></div></div>
          {login?.url ? <PrimaryButton icon="external" onClick={() => void api!.openExternal(login.url!)}>Open sign-in page</PrimaryButton> : null}
        </>}
      </motion.div>
    </motion.div>
  );
}

function SurfaceHeader({ eyebrow, title, body, actions }: { eyebrow: string; title: string; body: string; actions?: ReactNode }) {
  return <header className="surface-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{body}</p></div>{actions ? <div className="surface-actions">{actions}</div> : null}</header>;
}
function NavGroup({ label, children }: { label: string; children: ReactNode }) { return <div className="nav-group"><span>{label}</span>{children}</div>; }
function NavItem({ active, icon, label, onClick, badge, dot }: { active: boolean; icon: IconName; label: string; onClick: () => void; badge?: string; dot?: 'success' | 'attention' }) { return <button className={`nav-item ${active ? 'is-active' : ''}`} onClick={onClick} type="button"><Icon name={icon}/><span>{label}</span>{badge ? <em>{badge}</em> : null}{dot ? <StatusDot tone={dot === 'success' ? 'success' : 'warning'} /> : null}</button>; }
function BrandMark() { return <div className="brand-mark"><span/><span/></div>; }
function StatusDot({ tone }: { tone: 'success' | 'warning' | 'error' | 'neutral' }) { return <span className={`status-dot ${tone}`} />; }
function PrimaryButton({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName }) { return <button className="button primary" type="button" {...props}>{icon ? <Icon name={icon}/> : null}<span>{children}</span></button>; }
function SecondaryButton({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName }) { return <button className="button secondary" type="button" {...props}>{icon ? <Icon name={icon}/> : null}<span>{children}</span></button>; }
function IconButton({ icon, label, danger, onClick }: { icon: IconName; label: string; danger?: boolean; onClick: () => void }) { return <button aria-label={label} className={`icon-button ${danger ? 'danger' : ''}`} onClick={onClick} title={label} type="button"><Icon name={icon}/></button>; }
function Metric({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'neutral' }) { return <div className="metric"><span>{label}</span><strong className={tone === 'success' ? 'success-text' : ''}>{value}</strong></div>; }
function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div><div className="setting-value">{children}</div></div>; }
function Toggle({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) { return <button aria-checked={checked} className={`toggle ${checked ? 'is-on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)} role="switch" type="button"><span/></button>; }
function OperationPill({ operation }: { operation: Operation }) { return <motion.div animate={{ opacity: 1, y: 0 }} className="operation-pill" exit={{ opacity: 0, y: 8 }} initial={{ opacity: 0, y: 8 }}><div className="spinner small"/><span>{operation.name}</span></motion.div>; }
function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) { return <motion.div animate={{ opacity: 1, y: 0 }} className="error-toast" exit={{ opacity: 0, y: 8 }} initial={{ opacity: 0, y: 8 }}><span>{message}</span><button onClick={onDismiss} type="button">Dismiss</button></motion.div>; }
function LoadingState() { return <div className="center-state"><BrandMark/><div className="spinner"/><span>Loading CodexRouter…</span></div>; }
function FatalState({ title, body }: { title: string; body: string }) { return <div className="center-state"><h1>{title}</h1><p>{body}</p></div>; }
function formatPlan(plan: string) { const normalized = String(plan).replace(/[_-]+/g, ' '); return normalized.replace(/\b\w/g, char => char.toUpperCase()); }
function initials(value: string) { return value.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'A'; }
function formatReset(seconds: number) { return new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function loginStateLabel(state?: string) { if (state === 'starting') return 'Starting Codex login…'; if (state === 'waiting-for-browser') return 'Waiting for browser authentication…'; if (state === 'authenticated') return 'Authentication complete'; return 'Waiting for Codex…'; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function run(work: () => Promise<unknown>, setError: (message: string | null) => void) { setError(null); try { await work(); } catch (cause) { setError(messageOf(cause)); } }
async function doAndRefresh(work: () => Promise<unknown>, refresh: () => Promise<void>, setError: (message: string | null) => void) { await run(async () => { await work(); await refresh(); }, setError); }
