// UI structure and interaction language adapted from the MIT-licensed
// miuuyy/codex-chatgpt-web launcher. Product flows are CodexRouter-specific.
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import type { AccountSummary, AccountUsage, LauncherEvent, LogRecord, Operation, Snapshot } from './types';

const api = window.codexRouter;
type Surface = 'overview' | 'accounts' | 'setup' | 'activity' | 'settings' | 'account-detail';
const transition = { duration: 0.26, ease: [0.16, 1, 0.3, 1] } as const;

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [surface, setSurface] = useState<Surface>('overview');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [login, setLogin] = useState<{ accountId?: string; state?: string; url?: string } | null>(null);
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(null);
  const [updateState, setUpdateState] = useState<'available' | 'downloading' | 'ready' | 'installing' | 'error' | null>(null);
  const [updateProgress, setUpdateProgress] = useState(0);

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
      if (event.type === 'update-available') { setUpdate({ version: event.version, url: event.url }); setUpdateState('available'); setUpdateProgress(0); }
      if (event.type === 'update-progress') { setUpdateState('downloading'); setUpdateProgress(event.percent); }
      if (event.type === 'update-downloaded') { setUpdateState('ready'); setUpdateProgress(100); }
      if (event.type === 'update-state' && event.state === 'error') setUpdateState('error');
    });
  }, [refresh]);

  if (!api) return <FatalState title="Desktop bridge unavailable" body="CodexRouter could not initialize its secure Electron bridge." />;
  if (!snapshot) return <LoadingState />;

  const needsSetup = snapshot.accounts.length > 0 && (!snapshot.integration.installed || !snapshot.runtime.running);
  const activeAccount = snapshot.accounts.find(account => account.isActive) ?? null;

  return (
    <div className={`app-root platform-${snapshot.platform}`}>
      <aside className="sidebar draggable">
        <div className="sidebar-brand">
          <BrandMark />
          <div><strong>CodexRouter</strong><span>v{snapshot.version}</span></div>
        </div>

        <nav className="sidebar-nav" aria-label="CodexRouter">
          <NavGroup label="Workspace">
            <NavItem active={surface === 'overview'} icon="activity" label="Overview" onClick={() => setSurface('overview')} />
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
              <strong>{snapshot.runtime.running ? 'Router online' : 'Router offline'}</strong>
              <span>{activeAccount ? `${activeAccount.label} · ${activeAccount.preferredModel || 'sync model'}` : 'No active account'}</span>
            </div>
          </div>
          <button className="sidebar-codex" onClick={() => void run(() => api.openCodex(), setError)} type="button">
            <Icon name="brain" />Open Codex<Icon name="external" />
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
          {update ? <div className="update-banner"><span><strong>CodexRouter {update.version}</strong>{updateState === 'downloading' ? `Downloading update… ${Math.round(updateProgress)}%` : updateState === 'ready' ? 'Ready to install and restart.' : updateState === 'error' ? 'Download failed. Try again.' : 'New update available.'}</span>{updateState === 'available' || updateState === 'error' ? <button onClick={() => { setUpdateState('downloading'); void api.downloadUpdate().catch(() => setUpdateState('error')); }} type="button"><Icon name="download" />Download</button> : null}{updateState === 'ready' ? <button onClick={() => { setUpdateState('installing'); void api.installUpdate(); }} type="button"><Icon name="refresh" />Install & restart</button> : null}<button onClick={() => setUpdate(null)} type="button"><Icon name="close" />Hide</button>{updateState === 'downloading' ? <div aria-label={`Download progress ${Math.round(updateProgress)}%`} className="update-progress"><i style={{ width: `${updateProgress}%` }} /></div> : null}</div> : null}
          <AnimatePresence mode="wait">
            <motion.section animate={{ opacity: 1, y: 0 }} className="surface" exit={{ opacity: 0, y: -5 }} initial={{ opacity: 0, y: 7 }} key={surface} transition={transition}>
              {surface === 'overview' ? <OverviewSurface snapshot={snapshot} logs={logs} onOpenAccount={accountId => { setSelectedAccountId(accountId); setSurface('account-detail'); }} onOpenActivity={() => setSurface('activity')} /> : null}
              {surface === 'accounts' ? <AccountsSurface snapshot={snapshot} onAdd={() => setAddOpen(true)} onRefresh={refresh} setError={setError} setLogin={setLogin} onOpenAccount={accountId => { setSelectedAccountId(accountId); setSurface('account-detail'); }} /> : null}
              {surface === 'setup' ? <SetupSurface snapshot={snapshot} onRefresh={refresh} setError={setError} /> : null}
              {surface === 'activity' ? <ActivitySurface logs={logs} snapshot={snapshot} /> : null}
              {surface === 'account-detail' ? <AccountDetailSurface account={snapshot.accounts.find(item => item.id === selectedAccountId) ?? activeAccount} logs={logs} onBack={() => setSurface('overview')} /> : null}
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

function AccountsSurface({ snapshot, onAdd, onRefresh, setError, setLogin, onOpenAccount }: {
  snapshot: Snapshot;
  onAdd: () => void;
  onRefresh: () => Promise<void>;
  setError: (message: string | null) => void;
  setLogin: (value: { accountId?: string; state?: string; url?: string } | null) => void;
  onOpenAccount: (accountId: string) => void;
}) {
  return (
    <>
      <SurfaceHeader
        eyebrow="Gateway" icon="accounts"
        title="One model in Codex. Accounts live here."
        body={`Codex shows the native models from your connected accounts. This app controls account routing, model defaults and effort.`}
        actions={<PrimaryButton icon="plus" onClick={onAdd}>Add Account</PrimaryButton>}
      />

      {snapshot.accounts.length === 0 ? <EmptyAccounts onAdd={onAdd} /> : (
        <div className="account-list">
          {snapshot.accounts.map(account => (
            <AccountRow
              account={account}
              key={account.id}
              onOpen={() => onOpenAccount(account.id)}
              onToggle={async () => {
                try { await api!.setAccountEnabled(account.id, !account.enabled); await onRefresh(); } catch (cause) { setError(messageOf(cause)); }
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
        <p>Refresh reads the real Codex catalog for each connected account and rebuilds the model list.</p>
      </div>
    </>
  );
}

function AccountRow({ account, onToggle, onReauth, onRemove, onOpen }: {
  account: AccountSummary;
  onToggle: () => void;
  onReauth: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const cooldown = account.usage?.status === 'cooldown';
  const statusTone = !account.connected ? 'error' : !account.enabled ? 'neutral' : cooldown ? 'warning' : account.usage?.status === 'unknown' ? 'neutral' : 'success';
  const statusText = !account.connected ? 'Needs login' : !account.enabled ? 'Disabled' : cooldown ? 'Cooldown' : account.usage?.status === 'unknown' ? 'Usage unknown' : account.isActive ? 'Active' : 'Ready';
  const usage = account.usage;

  return (
    <div className="account-row" onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onOpen(); }} role="button" tabIndex={0}>
      <div className="account-avatar">{initials(account.label)}</div>
      <div className="account-identity">
        <div className="account-title-line">
          <strong>{account.label}</strong>
          {account.isActive ? <span className="soft-badge">Default</span> : null}
          {account.plan ? <span className="plan-badge">{formatPlan(account.plan)}</span> : null}
        </div>
          <span>{account.email || 'Email becomes available after login'}{account.preferredModel ? ` · ${account.preferredModel}` : ''}{account.preferredEffort ? ` · ${account.preferredEffort} effort` : ''}</span>
      </div>
      <div className="account-quota-summary" aria-label="Quota summary">
        <span><b>5h</b>{formatRemaining(usage?.primary?.remainingPercent)}<small>{formatReset(usage?.primary?.resetsAt)}</small></span>
        <span><b>Week</b>{formatRemaining(usage?.secondary?.remainingPercent)}<small>{formatReset(usage?.secondary?.resetsAt)}</small></span>
      </div>
      <div className="account-status"><StatusDot tone={statusTone} /><span>{statusText}</span></div>
      <div className="account-actions" onClick={event => event.stopPropagation()}>
        <Toggle checked={account.enabled} onChange={onToggle} label={`${account.enabled ? 'Disable' : 'Enable'} ${account.label} for gateway`} />
        <IconButton icon="refresh" label="Re-authenticate" onClick={onReauth} />
        <IconButton danger icon="trash" label="Remove" onClick={onRemove} />
      </div>
    </div>
  );
}

function OverviewSurface({ snapshot, logs, onOpenAccount, onOpenActivity }: { snapshot: Snapshot; logs: LogRecord[]; onOpenAccount: (accountId: string) => void; onOpenActivity: () => void }) {
  const requests = uniqueRequestLogs(logs);
  const successful = requests.filter(log => Number((log.details as { status?: number }).status) < 400).length;
  const totalTokens = requests.reduce((sum, log) => sum + Number((log.details as { usage?: { totalTokens?: number } }).usage?.totalTokens || 0), 0);
  const modelCounts = new Map<string, number>();
  requests.forEach(log => { const model = String((log.details as { model?: string }).model || 'unknown'); modelCounts.set(model, (modelCounts.get(model) || 0) + 1); });
  const topModels = [...modelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <>
      <SurfaceHeader eyebrow="Workspace" icon="activity" title="Router overview" body="A live view of account health, traffic and the models carrying your Codex work." actions={<SecondaryButton icon="activity" onClick={onOpenActivity}>View activity</SecondaryButton>} />
      <div className="overview-hero"><div><span className="eyebrow">Today</span><strong>{snapshot.runtime.running ? 'Gateway is ready' : 'Gateway is stopped'}</strong><p>{snapshot.accounts.length} configured accounts · {successful} successful requests in this session</p></div><div className="hero-pulse"><StatusDot tone={snapshot.runtime.running ? 'success' : 'neutral'} /><span>{snapshot.runtime.running ? 'Routing live' : 'Waiting to start'}</span></div></div>
      <div className="overview-metrics">
        <Metric icon="activity" label="Requests" value={String(requests.length)} />
        <Metric icon="check" label="Success rate" value={requests.length ? `${Math.round(successful / requests.length * 100)}%` : '—'} />
        <Metric icon="brain" label="Tokens reported" value={totalTokens ? formatNumber(totalTokens) : 'Awaiting data'} />
        <Metric icon="accounts" label="Accounts" value={String(snapshot.accounts.length)} />
      </div>
      <div className="overview-grid">
        <div className="overview-panel account-health"><PanelHeading title="Account health" action={`${snapshot.accounts.length} connected`} />{snapshot.accounts.map((account, index) => <motion.button animate={{ opacity: 1, y: 0 }} className="health-row" initial={{ opacity: 0, y: 8 }} key={account.id} onClick={() => onOpenAccount(account.id)} transition={{ ...transition, delay: index * .04 }} type="button"><span className="mini-avatar">{initials(account.label)}</span><span className="health-name"><strong>{account.label}</strong><small>{account.preferredModel || 'No model selected'}</small></span><span className="health-bar"><i style={{ width: `${Math.max(0, Math.min(100, account.usage?.primary?.remainingPercent ?? 0))}%` }} /></span><strong className="health-percent">{account.usage?.primary?.remainingPercent == null ? '—' : `${Math.round(account.usage.primary.remainingPercent)}%`}</strong></motion.button>)}</div>
        <div className="overview-panel model-rank"><PanelHeading title="Most used models" action="This session" />{topModels.length ? topModels.map(([model, count], index) => <div className="rank-row" key={model}><span className="rank-index">0{index + 1}</span><span>{model}</span><strong>{count}</strong><div className="rank-track"><i style={{ width: `${Math.max(12, count / topModels[0][1] * 100)}%` }} /></div></div>) : <EmptyInline title="No model traffic yet" body="Requests will appear here after the Router handles a Codex turn." />}</div>
      </div>
      <div className="overview-panel recent-panel"><PanelHeading title="Recent routing" action={<button className="text-action" onClick={onOpenActivity} type="button">Open full activity <Icon name="arrow-right" /></button>} />{requests.length ? requests.slice(-5).reverse().map(log => <div className="recent-row" key={log.id}><span className={`log-dot ${log.level}`} /><time>{new Date(log.at).toLocaleTimeString()}</time><strong>{String((log.details as { model?: string }).model || 'unknown')}</strong><span>{String((log.details as { account?: { label?: string } }).account?.label || 'Unassigned')}</span><em>{Number((log.details as { status?: number }).status) || '—'}</em></div>) : <EmptyInline title="No requests recorded" body="Start the gateway and send a request from Codex." />}</div>
    </>
  );
}

function AccountDetailSurface({ account, logs, onBack }: { account: AccountSummary | null; logs: LogRecord[]; onBack: () => void }) {
  if (!account) return <EmptyInline title="Account not found" body="This account may have been removed." />;
  const events = uniqueRequestLogs(logs).filter(log => String((log.details as { account?: { id?: string } })?.account?.id || '') === account.id);
  const requestCount = events.length;
  const tokens = events.reduce((sum, log) => sum + Number((log.details as { usage?: { totalTokens?: number } }).usage?.totalTokens || 0), 0);
  const primary = account.usage?.primary?.remainingPercent;
  const secondary = account.usage?.secondary?.remainingPercent;
  const modelCounts = new Map<string, number>();
  events.forEach(log => { const model = String((log.details as { model?: string }).model || 'unknown'); modelCounts.set(model, (modelCounts.get(model) || 0) + 1); });
  const models = [...modelCounts.entries()].sort((a, b) => b[1] - a[1]);
  return <>
    <button className="back-link" onClick={onBack} type="button"><Icon name="arrow-left" /> Overview</button>
    <SurfaceHeader eyebrow="Account detail" title={account.label} body={`${account.email || 'Connected account'} · ${account.plan || 'Codex plan'} · ${account.preferredModel || 'No default model'}`} actions={<span className="detail-status"><StatusDot tone={account.connected ? 'success' : 'error'} />{account.connected ? 'Connected' : 'Needs login'}</span>} />
    <div className="detail-metrics"><Metric icon="activity" label="Requests" value={String(requestCount)} /><Metric icon="brain" label="Tokens reported" value={tokens ? formatNumber(tokens) : 'Awaiting data'} /><Metric icon="refresh" label="5-hour window" value={formatRemaining(primary, ' left')} /><Metric icon="refresh" label="Weekly window" value={formatRemaining(secondary, ' left')} /></div>
    <div className="quota-panel"><PanelHeading title="Quota windows" action={`Checked ${account.usage?.checkedAt ? new Date(account.usage.checkedAt).toLocaleTimeString() : 'not yet'}`} /><QuotaLine label="5-hour limit" window={account.usage?.primary} /><QuotaLine label="Weekly limit" window={account.usage?.secondary} /><QuotaLine label="Spend control" value={account.usage?.spendControl?.remainingPercent ?? null} resetAt={account.usage?.spendControl?.resetsAt} /><div className="quota-state"><StatusDot tone={account.usage?.status === 'cooldown' ? 'warning' : account.usage?.status === 'available' ? 'success' : 'neutral'} /><span>{account.enabled ? (account.usage?.status === 'cooldown' ? `Cooldown until ${formatReset(account.usage.cooldownUntil)}` : account.usage?.status === 'available' ? 'Available for routing' : account.usageError || 'Waiting for usage data') : 'Disabled for gateway routing'}</span></div></div>
    <div className="detail-grid"><div className="overview-panel model-rank"><PanelHeading title="Models used" action="This session" />{models.length ? models.map(([model, count], index) => <div className="rank-row" key={model}><span className="rank-index">0{index + 1}</span><span>{model}</span><strong>{count}</strong><div className="rank-track"><i style={{ width: `${Math.max(12, count / models[0][1] * 100)}%` }} /></div></div>) : <EmptyInline title="No model traffic yet" body="Model distribution appears after this account handles requests." />}</div><div className="overview-panel recent-panel"><PanelHeading title="Requests handled" action={`${requestCount} total`} />{events.length ? events.slice(-12).reverse().map(log => <div className="recent-row" key={log.id}><span className={`log-dot ${log.level}`} /><time>{new Date(log.at).toLocaleTimeString()}</time><strong>{String((log.details as { model?: string }).model || 'unknown')}</strong><span>{String((log.details as { transport?: string }).transport || 'http')}</span><em>{Number((log.details as { status?: number }).status) || '—'}</em></div>) : <EmptyInline title="No requests for this account" body="The Router will show model and request details here." />}</div></div>
  </>;
}

function PanelHeading({ title, action }: { title: string; action?: ReactNode }) { return <div className="panel-heading"><strong>{title}</strong>{typeof action === 'string' ? <span>{action}</span> : action}</div>; }
function EmptyInline({ title, body }: { title: string; body: string }) { return <div className="empty-inline"><strong>{title}</strong><span>{body}</span></div>; }
function QuotaLine({ label, value, window, resetAt }: { label: string; value?: number | null; window?: AccountUsage['primary']; resetAt?: number | null }) { const actual = window?.remainingPercent ?? value; const visible = actual == null ? null : Math.max(0, Math.min(100, actual)); const reset = window?.resetsAt ?? resetAt; return <div className="quota-line"><span>{label}<small>{reset ? `resets ${formatReset(reset)}` : 'reset unknown'}</small></span><div className="quota-track"><i style={{ width: `${visible ?? 0}%` }} /></div><strong>{visible == null ? 'Unknown' : `${Math.round(visible)}% left`}</strong></div>; }
function formatNumber(value: number) { return new Intl.NumberFormat(undefined, { notation: value > 99999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value); }
function formatRemaining(value: number | null | undefined, suffix = '') { return value == null ? '—' : `${Math.round(value)}%${suffix}`; }
function uniqueRequestLogs(logs: LogRecord[]) {
  const byRequest = new Map<string, LogRecord>();
  for (const log of logs) {
    const details = log.details as { requestId?: string } | undefined;
    if (!details?.requestId) continue;
    const current = byRequest.get(details.requestId);
    if (!current) byRequest.set(details.requestId, log);
    else if (Boolean((details as { usageOnly?: boolean }).usageOnly)) {
      // The usage event arrives after the response event. Merge it so token
      // telemetry cannot replace the request metadata or vice versa.
      byRequest.set(details.requestId, { ...current, details: { ...(current.details as object), ...details } });
    }
  }
  return [...byRequest.values()];
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
      <SurfaceHeader eyebrow="Setup" icon="setup" title="One-time setup" body="Connect accounts here once. Codex only needs the single CodexRouter model." />
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
        {snapshot.integration.installed ? <SecondaryButton icon="trash" onClick={() => void doAndRefresh(() => api!.uninstall(), onRefresh, setError)}>Uninstall integration</SecondaryButton> : null}
      </div>

      <div className={`ready-panel ${snapshot.integration.installed && snapshot.runtime.running ? 'is-ready' : ''}`}>
        <div className="ready-icon"><Icon name={snapshot.integration.installed && snapshot.runtime.running ? 'check' : 'setup'} /></div>
        <div>
          <strong>{snapshot.integration.installed && snapshot.runtime.running ? 'Ready for Codex' : 'Finish setup to expose the gateway'}</strong>
          <p>{snapshot.integration.installed && snapshot.runtime.running ? `Open Codex and choose “${snapshot.gateway.displayName}”. Account and native model stay managed here.` : 'Your account profiles remain isolated before the global integration is installed.'}</p>
        </div>
        <PrimaryButton icon="brain" disabled={!snapshot.integration.installed || !snapshot.runtime.running} onClick={() => void run(() => api!.openCodex(), setError)}>Open Codex</PrimaryButton>
      </div>
    </>
  );
}

function SetupStep({ index, done, title, body }: { index: number; done: boolean; title: string; body: string }) {
  return <div className="setup-step"><span className={`step-index ${done ? 'is-done' : ''}`}>{done ? <Icon name="check" /> : index}</span><div><strong>{title}</strong><p>{body}</p></div><span className={done ? 'step-state success' : 'step-state'}>{done ? 'Complete' : 'Pending'}</span></div>;
}

function ActivitySurface({ logs, snapshot }: { logs: LogRecord[]; snapshot: Snapshot }) {
  const active = snapshot.accounts.find(account => account.isActive);
  const requests = uniqueRequestLogs(logs);
  const failures = requests.filter(log => Number((log.details as { status?: number }).status) >= 400).length;
  const tokens = requests.reduce((sum, log) => sum + Number((log.details as { usage?: { totalTokens?: number } }).usage?.totalTokens || 0), 0);
  return (
    <>
      <SurfaceHeader eyebrow="Runtime" icon="activity" title="Activity" body={`See every Router request, account attempt, upstream status and sanitized error. Persistent log: ${snapshot.logPath}`} />
      <div className="metrics-row">
        <Metric icon="power" label="Gateway" value={snapshot.runtime.running ? 'Running' : 'Stopped'} tone={snapshot.runtime.running ? 'success' : 'neutral'} />
        <Metric icon="activity" label="Requests" value={String(requests.length)} />
        <Metric icon="shield" label="Errors" value={String(failures)} tone={failures ? 'neutral' : 'success'} />
        <Metric icon="brain" label="Tokens reported" value={tokens ? formatNumber(tokens) : 'Awaiting data'} />
        <Metric icon="accounts" label="Active account" value={active?.label || 'None'} />
        <Metric icon="refresh" label="Usage" value={active?.usage?.primary?.remainingPercent == null ? 'Unknown' : `${Math.round(active.usage.primary.remainingPercent)}% left`} />
      </div>
      <div className="log-view">
        <div className="log-head"><span>Recent events</span><span>{logs.length} events · {requests.length} requests</span></div>
        {logs.length ? [...logs].reverse().map(log => <div className="log-row" key={log.id}><span className={`log-dot ${log.level}`} /><time>{new Date(log.at).toLocaleTimeString()}</time><span>{log.message}</span></div>) : <div className="log-empty">No runtime events yet.</div>}
      </div>
    </>
  );
}

function SettingsSurface({ snapshot, onRefresh, setError }: { snapshot: Snapshot; onRefresh: () => Promise<void>; setError: (message: string | null) => void }) {
  const active = snapshot.accounts.find(account => account.isActive) ?? null;
  const availableModels = active?.availableModels ?? [];
  const [model, setModel] = useState(active?.preferredModel ?? '');
  const [effort, setEffort] = useState(active?.preferredEffort ?? 'medium');
  const [saving, setSaving] = useState(false);
  const [jevMode, setJevMode] = useState<'off' | 'observe' | 'active'>(snapshot.jev.mode);
  const [jevModel, setJevModel] = useState(snapshot.jev.model);
  const [jevConfidence, setJevConfidence] = useState(snapshot.jev.minConfidence);
  const [jevAllowedModels, setJevAllowedModels] = useState<string[] | null>(snapshot.jev.allowedModels);
  const [jevKey, setJevKey] = useState('');
  const [jevSaving, setJevSaving] = useState(false);

  useEffect(() => {
    setModel(active?.preferredModel ?? '');
    setEffort(active?.preferredEffort ?? 'medium');
  }, [active?.id, active?.preferredModel, active?.preferredEffort]);

  useEffect(() => {
    setJevMode(snapshot.jev.mode);
    setJevModel(snapshot.jev.model);
    setJevConfidence(snapshot.jev.minConfidence);
    setJevAllowedModels(snapshot.jev.allowedModels);
    setJevKey('');
  }, [snapshot.jev.mode, snapshot.jev.model, snapshot.jev.minConfidence, snapshot.jev.allowedModels, snapshot.jev.keySource]);

  const savePreferences = async () => {
    if (!active || saving) return;
    setSaving(true);
    try { await api!.setAccountPreferences(active.id, { preferredModel: model || null, preferredEffort: effort || null }); await onRefresh(); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setSaving(false); }
  };

  const saveJev = async (options: { clearApiKey?: boolean } = {}) => {
    if (jevSaving) return;
    setJevSaving(true);
    try {
      await api!.setJevSettings({
        mode: jevMode,
        model: jevModel.trim(),
        minConfidence: jevConfidence,
        allowedModels: jevAllowedModels,
        ...(jevKey.trim() ? { apiKey: jevKey.trim() } : {}),
        ...(options.clearApiKey ? { clearApiKey: true } : {}),
      });
      setJevKey('');
      await onRefresh();
    } catch (cause) { setError(messageOf(cause)); }
    finally { setJevSaving(false); }
  };

  const normalizedJevAllowedModels = jevAllowedModels === null ? null : [...jevAllowedModels].sort();
  const savedJevAllowedModels = snapshot.jev.allowedModels === null ? null : [...snapshot.jev.allowedModels].sort();
  const jevChanged = jevMode !== snapshot.jev.mode
    || jevModel.trim() !== snapshot.jev.model
    || jevConfidence !== snapshot.jev.minConfidence
    || JSON.stringify(normalizedJevAllowedModels) !== JSON.stringify(savedJevAllowedModels)
    || Boolean(jevKey.trim());

  const jevModelAllowed = (slug: string) => jevAllowedModels === null || jevAllowedModels.includes(slug);
  const setJevModelAllowed = (slug: string, allowed: boolean) => {
    setJevAllowedModels(current => {
      const baseline = current === null ? availableModels.map(item => item.slug) : current;
      return allowed
        ? [...new Set([...baseline, slug])]
        : baseline.filter(item => item !== slug);
    });
  };

  const keyStatus = snapshot.jev.keySource === 'secure-storage'
    ? 'Stored with OS encryption'
    : snapshot.jev.keySource === 'environment'
      ? 'Provided by TYPESAFE_API_KEY'
      : 'Not configured';

  return (
    <>
      <SurfaceHeader eyebrow="Settings" icon="settings" title="Models, intelligence and desktop behavior" body="Control native Codex defaults and the optional Jev semantic routing layer." />
      <div className="settings-list">
        <SettingRow title="Default native model" description={active ? 'Model used behind CodexRouter for the active account. Refresh the gateway catalog to discover new models.' : 'Connect an account first.'}>
          <select aria-label="Default native model" disabled={!active || !availableModels.length || saving} onChange={event => setModel(event.target.value)} value={model}>
            {!availableModels.length ? <option value="">Refresh catalog first</option> : null}
            {availableModels.map(item => <option key={item.slug} value={item.slug}>{item.name} · {item.slug}</option>)}
          </select>
        </SettingRow>
        <SettingRow title="Default reasoning effort" description="Applied only when a request does not already specify reasoning.effort.">
          <select aria-label="Default reasoning effort" disabled={!active || saving} onChange={event => setEffort(event.target.value)} value={effort}>
            {['minimal', 'low', 'medium', 'high', 'xhigh'].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </SettingRow>
        <div className="settings-save"><PrimaryButton disabled={!active || saving || (model === (active?.preferredModel ?? '') && effort === (active?.preferredEffort ?? 'medium'))} onClick={() => void savePreferences()}> {saving ? 'Saving…' : 'Save model defaults'}</PrimaryButton></div>

        <SettingRow title="Jev semantic routing" description="Off makes no external call. Observe records a shadow recommendation. Active may apply high-confidence model and effort recommendations only to the managed Router model.">
          <select aria-label="Jev semantic routing mode" disabled={jevSaving} onChange={event => setJevMode(event.target.value as 'off' | 'observe' | 'active')} value={jevMode}>
            <option value="off">Off</option>
            <option value="observe">Observe</option>
            <option value="active">Active</option>
          </select>
        </SettingRow>
        <SettingRow title="TypeSafe API key" description={snapshot.jev.secureStorageAvailable ? 'A new key is encrypted by the operating system and never exposed back to the renderer.' : 'Secure OS storage is unavailable here. Use TYPESAFE_API_KEY instead.'}>
          <input aria-label="TypeSafe API key" autoComplete="off" disabled={!snapshot.jev.secureStorageAvailable || jevSaving} onChange={event => setJevKey(event.target.value)} placeholder={snapshot.jev.configured ? 'Configured · leave blank to keep' : 'Paste a TypeSafe API key'} spellCheck={false} type="password" value={jevKey} />
        </SettingRow>
        <SettingRow title="Jev key status" description="The renderer receives only configuration status, never the stored secret.">
          {snapshot.jev.keySource === 'secure-storage'
            ? <SecondaryButton disabled={jevSaving} onClick={() => void saveJev({ clearApiKey: true })}>Clear stored key</SecondaryButton>
            : <span className="value-text">{keyStatus}</span>}
        </SettingRow>
        <SettingRow title="Jev model" description="Pinned for reproducible routing measurements; change deliberately when evaluating a new Jev version.">
          <input aria-label="Jev model" disabled={jevSaving} maxLength={120} onChange={event => setJevModel(event.target.value)} spellCheck={false} value={jevModel} />
        </SettingRow>
        <SettingRow title="Jev confidence gate" description="Active mode changes model or effort only when the corresponding typed decision meets this threshold.">
          <input aria-label="Jev minimum confidence" disabled={jevSaving} max={1} min={0} onChange={event => setJevConfidence(Number(event.target.value))} step={0.01} type="number" value={jevConfidence} />
        </SettingRow>
        <SettingRow title="Models Jev may use" description="Hard allowlist applied after Jev chooses a tier. Disabled models can never be selected by Jev; explicit manual model choices are unaffected.">
          <div className="jev-model-policy">
            <div className="jev-model-policy-actions">
              <SecondaryButton disabled={jevSaving || jevAllowedModels === null} onClick={() => setJevAllowedModels(null)}>Allow all</SecondaryButton>
              <SecondaryButton disabled={jevSaving || jevAllowedModels?.length === 0} onClick={() => setJevAllowedModels([])}>Disable all</SecondaryButton>
            </div>
            {availableModels.length ? availableModels.map(item => (
              <div className="jev-model-policy-row" key={item.slug}>
                <span><strong>{item.name}</strong><code>{item.slug}</code></span>
                <Toggle checked={jevModelAllowed(item.slug)} disabled={jevSaving} label={`Allow Jev to use ${item.name}`} onChange={checked => setJevModelAllowed(item.slug, checked)} />
              </div>
            )) : <span className="value-text">Refresh the active account catalog to configure model eligibility.</span>}
            <small>{jevAllowedModels === null ? 'All current and future discovered models are eligible.' : `${jevAllowedModels.length} model(s) explicitly eligible.`}</small>
          </div>
        </SettingRow>
        <div className="settings-save"><PrimaryButton disabled={jevSaving || !jevChanged || !jevModel.trim()} onClick={() => void saveJev()}>{jevSaving ? 'Saving…' : 'Save Jev settings'}</PrimaryButton></div>

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
  const [authMode, setAuthMode] = useState<'local' | 'login'>('local');
  const [busy, setBusy] = useState(false);
  const waiting = busy || Boolean(login?.state);
  const submit = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    setError(null);
    try { await api!.addAccount(label.trim(), authMode); await onComplete(); }
    catch (cause) { setError(messageOf(cause)); setBusy(false); }
  };

  return (
    <motion.div animate={{ opacity: 1 }} className="modal-backdrop" exit={{ opacity: 0 }} initial={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget && !waiting) onClose(); }}>
      <motion.div animate={{ opacity: 1, scale: 1, y: 0 }} className="modal" exit={{ opacity: 0, scale: 0.98, y: 4 }} initial={{ opacity: 0, scale: 0.98, y: 8 }} transition={transition}>
        <div className="modal-kicker">Add ChatGPT account</div>
        {!waiting ? <>
          <h2>Name this account</h2>
          <p>Choose whether this profile uses the Codex session already on this Mac or a new official browser login.</p>
          <label className="field-label" htmlFor="account-label">Account label</label>
          <input autoFocus id="account-label" maxLength={80} onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submit(); }} placeholder="Cesar" value={label} />
          <div className="auth-choice-group" role="radiogroup" aria-label="Authentication method">
            <button className={`auth-choice ${authMode === 'local' ? 'is-selected' : ''}`} onClick={() => setAuthMode('local')} role="radio" aria-checked={authMode === 'local'} type="button">
              <strong>Use local Codex account</strong><span>Reuse the existing session from <code>~/.codex</code>.</span>
            </button>
            <button className={`auth-choice ${authMode === 'login' ? 'is-selected' : ''}`} onClick={() => setAuthMode('login')} role="radio" aria-checked={authMode === 'login'} type="button">
              <strong>Sign in with browser</strong><span>Open the official OpenAI login flow.</span>
            </button>
          </div>
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

function SurfaceHeader({ eyebrow, icon, title, body, actions }: { eyebrow: string; icon?: IconName; title: string; body: string; actions?: ReactNode }) {
  return <header className="surface-header"><div><span className="eyebrow">{icon ? <Icon name={icon} /> : null}{eyebrow}</span><h1>{title}</h1><p>{body}</p></div>{actions ? <div className="surface-actions">{actions}</div> : null}</header>;
}
function NavGroup({ label, children }: { label: string; children: ReactNode }) { return <div className="nav-group"><span>{label}</span>{children}</div>; }
function NavItem({ active, icon, label, onClick, badge, dot }: { active: boolean; icon: IconName; label: string; onClick: () => void; badge?: string; dot?: 'success' | 'attention' }) { return <button className={`nav-item ${active ? 'is-active' : ''}`} onClick={onClick} type="button"><Icon name={icon}/><span>{label}</span>{badge ? <em>{badge}</em> : null}{dot ? <StatusDot tone={dot === 'success' ? 'success' : 'warning'} /> : null}</button>; }
function BrandMark() { return <div aria-hidden="true" className="brand-mark"><span /></div>; }
function StatusDot({ tone }: { tone: 'success' | 'warning' | 'error' | 'neutral' }) { return <span className={`status-dot ${tone}`} />; }
function PrimaryButton({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName }) { return <button className="button primary" type="button" {...props}>{icon ? <Icon name={icon}/> : null}<span>{children}</span></button>; }
function SecondaryButton({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName }) { return <button className="button secondary" type="button" {...props}>{icon ? <Icon name={icon}/> : null}<span>{children}</span></button>; }
function IconButton({ icon, label, danger, onClick }: { icon: IconName; label: string; danger?: boolean; onClick: () => void }) { return <button aria-label={label} className={`icon-button ${danger ? 'danger' : ''}`} onClick={onClick} title={label} type="button"><Icon name={icon}/></button>; }
function Metric({ label, value, tone, icon }: { label: string; value: string; tone?: 'success' | 'neutral'; icon?: IconName }) { return <div className="metric"> <span>{icon ? <Icon name={icon} /> : null}{label}</span><strong className={tone === 'success' ? 'success-text' : ''}>{value}</strong></div>; }
function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div><div className="setting-value">{children}</div></div>; }
function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label?: string; onChange: (checked: boolean) => void }) { return <button aria-label={label} aria-checked={checked} className={`toggle ${checked ? 'is-on' : ''}`} disabled={disabled} onClick={event => { event.stopPropagation(); onChange(!checked); }} role="switch" type="button"><span/></button>; }
function OperationPill({ operation }: { operation: Operation }) { return <motion.div animate={{ opacity: 1, y: 0 }} className="operation-pill" exit={{ opacity: 0, y: 8 }} initial={{ opacity: 0, y: 8 }}><div className="spinner small"/><span>{operation.name}</span></motion.div>; }
function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) { return <motion.div animate={{ opacity: 1, y: 0 }} className="error-toast" exit={{ opacity: 0, y: 8 }} initial={{ opacity: 0, y: 8 }}><Icon name="shield" /><span>{message}</span><button aria-label="Dismiss error" onClick={onDismiss} title="Dismiss error" type="button"><Icon name="close" /></button></motion.div>; }
function LoadingState() { return <div className="center-state"><BrandMark/><div className="spinner"/><span>Loading CodexRouter…</span></div>; }
function FatalState({ title, body }: { title: string; body: string }) { return <div className="center-state"><h1>{title}</h1><p>{body}</p></div>; }
function formatPlan(plan: string) { const normalized = String(plan).replace(/[_-]+/g, ' '); return normalized.replace(/\b\w/g, char => char.toUpperCase()); }
function initials(value: string) { return value.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'A'; }
function formatReset(seconds: number | null | undefined) { if (!seconds) return 'reset unknown'; return new Date(seconds * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }); }
function loginStateLabel(state?: string) { if (state === 'reusing-session') return 'Reusing your existing Codex session…'; if (state === 'starting') return 'Starting Codex login…'; if (state === 'waiting-for-browser') return 'Waiting for browser authentication…'; if (state === 'authenticated') return 'Authentication complete'; return 'Waiting for Codex…'; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function run(work: () => Promise<unknown>, setError: (message: string | null) => void) { setError(null); try { await work(); } catch (cause) { setError(messageOf(cause)); } }
async function doAndRefresh(work: () => Promise<unknown>, refresh: () => Promise<void>, setError: (message: string | null) => void) { await run(async () => { await work(); await refresh(); }, setError); }
