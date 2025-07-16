# Recommendation: Transitioning Cronium’s Remote‑Execution Model to an Ephemeral Runner over SSH

## 1 Goals & Scope

- Replace today’s **raw‑SSH script execution** with a **signed, single‑file Runner binary** that the orchestrator copies to the target host for each job (or cached per host/arch).
- Preserve existing UX for events written in **Bash, Node.js, or Python** and for **runtime‑helper** calls (`cronium.input()`, `cronium.output()`, `cronium.getVariable()`, ...).
- **Disallow** execution of **Tool Action events** over SSH; those remain exclusive to the containerised `cronium‑agent`.
- Provide a secure, auditable path forward with minimal host prerequisites (SSH + outbound egress optional).

---

## 2 Current State (July 2025)

| Component             | Behaviour today                                       |
| --------------------- | ----------------------------------------------------- |
| Orchestrator → target | Opens SSH, pastes script inline.                      |
| Runtime helpers       | **Not yet implemented** in SSH mode.                  |
| Tool actions          | Executed via the same SSH channel (security concern). |

Pain points: no sandboxing, helpers unavailable, difficult variable isolation, and tool actions unintentionally exposed on untrusted hosts.

---

## 3 Proposed Architecture

```
┌─────────────┐       SSH        ┌──────────────┐
│ cronium‑app │ ——— control ———→ │ orchestrator │
└─────────────┘                  │              │
                                 │ build Runner │
                                 └─────┬────────┘
                                       │ scp/ssh
                                       ▼
                                 ┌─────────────┐
                                 │ target host │
                                 │  /tmp/…     │
                                 │ runner ▸    │
                                 │ payload.tgz │
                                 └─────────────┘
```

- **Runner binary**: static x‑compile Go file, \~3 MB, per OS/arch.
- **Payload** (`payload.tgz`): user script, manifest, optional bundled helpers.
- **SSH tunnel** (port‑forward) optionally exposes Helper API back to orchestrator for dynamic helper downloads.
- **Integrity**: Runner and payload signed with **cosign**; verified on the host before execution.

---

## 4 Creating & Caching Runner Modules

| Aspect            | Recommendation                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Build trigger** | _Per event version change._ When a user saves/updates an event, orchestrator compiles a new Runner‑payload pair.                           |
| **Binary reuse**  | The **Runner binary** is architecture‑specific and **cached per host** (checksum checked). Only copied again if version/hash differs.      |
| **Payload reuse** | Rebuilt **when the script or manifest changes**; otherwise reused across multiple job executions.                                          |
| **Storage**       | Store artefacts in `s3://cronium‑runner‑cache/<eventId>/<version>/` (or local FS). Clean up via TTL policy (e.g., 90 days since last run). |

---

## 5 Runtime Helpers

### 5.1 Design Principles

- Same helper surface regardless of execution mode (agent vs SSH).
- **Least privilege**: helpers receive a short‑lived JWT scoped to the job and read‑only variable set.
- **Integrity**: helpers are either bundled or fetched over a signed channel.

### 5.2 Operational Modes

| Mode                        | When used                                     | Transport                           | Auth            | Notes                                                           |
| --------------------------- | --------------------------------------------- | ----------------------------------- | --------------- | --------------------------------------------------------------- |
| **Bundled** (default)       | Hosts without egress or strict change‑control | Local file system                   | n/a (local)     | Helpers live under `helpers/`. Runner sets `PATH` and env vars. |
| **Dynamic via SSH tunnel**  | Hosts with egress blocked but SSH allowed     | `ssh -R` port‑forward to Helper API | JWT + SSH trust | Runner downloads freshest helper tarball; verifies cosign sig.  |
| **Dynamic via Tailnet/VPN** | Opt‑in fleet using Tailscale/WG               | WireGuard/TLS                       | JWT + mTLS      | Helper API not exposed publicly.                                |

### 5.3 Secure Variable Access (`cronium.getVariable()`)

1. **Runner injects** `CRONIUM_VAR_TOKEN=<JWT>` (aud = variable‑scope, exp ≈ 5 min).
2. Helper CLI/SDK hits `/api/variables/:id` over the same tunnel/VPN with Bearer JWT.
3. Orchestrator enforces RBAC; response delivered as JSON.
4. For **bundled‑offline** mode, variables can be pre‑materialised into `variables.json` in the payload (encrypted with host‑public GPG key if confidentiality is required).

---

## 6 Script Execution Flow

1. Runner unpacks payload into `/tmp/cronium‑run‑<uuid>`.
2. Sets up runtime:
   - `PATH=$PWD/helpers:$PATH`
   - `CRONIUM_VAR_TOKEN`, `CRONIUM_INPUT_FILE`, `CRONIUM_OUTPUT_FILE`, etc.
3. Detects interpreter via manifest (`type: bash | node | python`).
4. Launches script under the _non‑privileged_ SSH user (optionally inside `chroot` or `systemd‑sandbox`).
5. Streams stdout/stderr back through the SSH channel; writes outputs JSON.
6. On completion, Runner uploads `outputs.json` to orchestrator (scp over the same SSH session).
7. Cleans up the working directory.

> **Tool Action events** are blocked at manifest‑parse time if `executionMethod=ssh‑runner`.

---

## 7 Security Controls

- **Transport**: OpenSSH with `ProxyJump` or VPN; no inbound ports required.
- **Integrity**: cosign‑signed Runner & payload; orchestrator refuses to run if verify fails.
- **Secrets**: JWTs scoped to job; variables fetched on‑demand; optional GPG encryption at rest.
- **Resource limits** (optional): Runner can use `ulimit` or `systemd‑run --scope -p MemoryMax=` to approximate container limits.

---

## 8 Migration Plan

| Phase        | Milestone                                   | Actions                                                                                                |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **0 (Prep)** | Design signed build‑pipeline                | • Set up cosign keypair & CI job to build Runner per arch.                                             |
| **1**        | Implement payload builder & manifest schema | • Extend event model with `runtimeVersion`. • Produce `payload.tgz` on event save.                     |
| **2**        | Add Runner execution path                   | • Orchestrator detects target lacking agent; chooses SSH‑Runner. • Implement copy‑verify‑exec‑cleanup. |
| **3**        | Runtime helper MVP (bundled)                | • Embed CLI/SDK; implement input/output file contract.                                                 |
| **4**        | Secure variable access API                  | • JWT issuance & validation endpoints.                                                                 |
| **5**        | Helper dynamic fetch via SSH tunnel         | • Add `--helper-fetch=remote` flag; implement port‑forward + signature check.                          |
| **6**        | Deprecate raw‑SSH path                      | • Toggle feature flag off; document end‑of‑life date.                                                  |

---

## 9 Operational & Monitoring Considerations

- **Artifact cache metrics**: hit/miss ratio, build time per payload.
- **Signature‑verify failures**: alert with eventId, host, checksum.
- **Runner exit codes**: map to Cronium statuses (OK, ERROR, TIMEOUT, SIG KILL).
- **SSH latency & copy time**: include in job telemetry for capacity planning.
