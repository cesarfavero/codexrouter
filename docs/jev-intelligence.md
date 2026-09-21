# Jev intelligence layer

CodexRouter can use TypeSafe Jev as an optional semantic decision layer for the managed `codexrouter/gateway`.

Jev does not replace the Router. It advises the parts that benefit from semantic judgment. Deterministic code remains authoritative for authentication, account eligibility, usage windows, cooldowns, 401 refresh, 429 failover, permissions, dates and exact calculations.

## Architecture

```text
Codex request
    |
    v
decode / normalize
    |
    +--> deterministic account + quota policy
    |
    +--> Jev semantic advisor (optional)
    |      |- task tier: economy / balanced / deep
    |      |- reasoning effort
    |      |- verification need
    |      |- research dependence
    |      |- decomposition gain
    |      |- prior-failure signal
    |      '- semantic risk
    |
    v
confidence gate
    |
    +--> observe: record recommendation only
    |
    '--> active: constrain recommendation to models
          actually available on the selected account
    |
    v
official Codex upstream
```

Only requests whose model is exactly `codexrouter/gateway` are eligible for Jev routing. Explicit native model requests and account-qualified model requests stay authoritative and bypass the semantic advisor.

## Modes

### off

Default. No TypeSafe request is made and CodexRouter behaves as before.

```bash
export CODEXROUTER_JEV_MODE=off
```

### observe

The Router sends the sanitized task state to Jev, records the structured recommendation and forwards the request using the existing model/effort policy. This is the recommended rollout mode because it produces a counterfactual dataset without changing task execution.

```bash
export TYPESAFE_API_KEY='...'
export CODEXROUTER_JEV_MODE=observe
```

### active

High-confidence recommendations may change the native model and reasoning effort behind `codexrouter/gateway`. A low-confidence response, timeout, budget limit, invalid payload or TypeSafe outage falls back to the existing Router policy.

```bash
export TYPESAFE_API_KEY='...'
export CODEXROUTER_JEV_MODE=active
```

A reasoning effort explicitly supplied by Codex is never overwritten by Jev.

## Desktop configuration

The packaged desktop app exposes the same controls under **Settings**:

- Jev mode: off, observe, or active;
- TypeSafe API key;
- pinned Jev model;
- minimum confidence gate.

When a key is entered in the desktop app, the main Electron process encrypts it with Electron `safeStorage` before writing it under the CodexRouter data directory. The renderer only receives whether a key is configured and whether it came from secure storage or the environment; it cannot read the secret back.

On systems where secure OS encryption is unavailable, CodexRouter refuses to persist a new TypeSafe key and expects `TYPESAFE_API_KEY` instead. Changing Jev settings restarts only the local Router runtime when it is already running; the Codex integration remains installed.

## Runtime configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | unset | TypeSafe API credential. Required for `observe` and `active`. |
| `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` | TypeSafe API base URL. |
| `CODEXROUTER_JEV_MODE` | `off` | `off`, `observe` or `active`. |
| `CODEXROUTER_JEV_MODEL` | `jev-1.13.0` | Pinned Jev model used for reproducible measurements. Override explicitly when upgrading. |
| `CODEXROUTER_JEV_TIMEOUT_MS` | `900` | Per-decision timeout. |
| `CODEXROUTER_JEV_MIN_CONFIDENCE` | `0.78` | Minimum confidence before active model/effort application. |
| `CODEXROUTER_JEV_MAX_CHARS` | `12000` | Maximum sanitized task characters transmitted. |
| `CODEXROUTER_JEV_SAMPLE_RATE` | `1` | Fraction from 0 to 1 of eligible gateway requests sampled. |
| `CODEXROUTER_JEV_CACHE_TTL_MS` | `300000` | In-memory decision-cache TTL. |
| `CODEXROUTER_JEV_MAX_RPM` | `60` | Maximum Jev decisions per process per rolling minute. |

The pinned default exists to keep experiments comparable. A deployment can move to another Jev version through `CODEXROUTER_JEV_MODEL` without changing code.

## Privacy and security boundary

Enabling `observe` or `active` creates a new external data flow to TypeSafe. Before the request leaves the machine, CodexRouter:

- extracts only known text-bearing fields from the Codex request rather than forwarding the complete request;
- caps the transmitted text;
- redacts common bearer/JWT/API/GitHub/AWS credentials, generic secret fields, email addresses and local macOS user path names;
- sends only non-secret routing metadata such as endpoint, tool count, continuation state, explicit reasoning effort and the local account's available model slugs;
- never sends the ChatGPT access token, refresh token, cookie, `auth.json`, account-id authentication header or Router registry;
- never writes the transmitted task text to Router telemetry.

Redaction is defense in depth, not a data-classification system. Workloads containing secrets, regulated data or other material that must not leave the machine should keep Jev `off`.

## Decision policy

Jev chooses an abstract tier, not an arbitrary model slug. CodexRouter maps that tier onto the models already exposed by the selected account:

- `economy`: prefer lower-cost/fast family members such as Luna when available;
- `balanced`: prefer the middle capability tier such as Terra or an equivalent model;
- `deep`: prefer the strongest available family member such as Sol.

The exact model is always constrained to the selected account's catalog. If Jev reports a strong prior-failure signal or high semantic risk, the Router can raise the recommendation by one tier before applying the confidence gate.

This does not give Jev authority over which subscription can be used. Account selection and quota headroom remain deterministic.

## Telemetry

Router request events can include a `jev` object with:

- status;
- Jev model id;
- decision latency;
- input token count;
- cache hit;
- task tier and confidence;
- effort and confidence;
- verification/research/decomposition/failure signals;
- semantic risk score;
- recommended model/effort;
- whether each recommendation was actually applied.

The prompt/task text is deliberately absent.

The useful rollout comparison is not “did Jev choose a stronger model?” but:

- task success without correction;
- number of retries/corrections;
- expensive-model utilization;
- total Codex tokens per completed task;
- Jev tokens and latency;
- test/review failure rate;
- escalation rate;
- agreement/disagreement between shadow recommendation and current routing.

## Development-time TypeSafe Skill

The TypeSafe Skill and the Jev runtime integration are separate concerns. Developers who want Codex to understand current TypeSafe design patterns can install the project skill:

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```

The Router runtime does not depend on that Skill being installed.

## Next layers

The current implementation establishes pre-route typed decisions and measurement. The architecture intentionally leaves room for deeper use without making Jev an all-powerful router:

1. **Response Judge**: tee completed Codex output into a post-response evidence/quality check without delaying streaming by default.
2. **Semantic retry**: distinguish transport/rate-limit failure from “the approach is failing” and escalate only the latter.
3. **Tool and Skill candidate selector**: prefilter a large tool/skill catalog, then let Codex reason over a small candidate set.
4. **Evidence gate**: score whether a claim is actually supported by retrieved repository/docs passages before publication.
5. **Change-risk gate**: use typed risk signals to require stronger tests/review for security, auth, migrations or production-sensitive changes.
6. **Outcome learner**: compare the pre-route recommendation with actual completion signals and calibrate thresholds from local aggregate metrics, without automatically training on private prompt content.
7. **Budget optimizer**: optimize for cost per successful task rather than price per request, escalating when a cheaper route statistically creates more rework.
8. **Policy packs**: project-specific decision rubrics stored in versioned, reviewable configuration instead of growing one global prompt.

Any future post-response or tool-selection layer must preserve the same fail-open execution rule for Jev availability and the same deterministic authority boundary for credentials, quotas and irreversible actions.
