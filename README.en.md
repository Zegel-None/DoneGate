# DoneGate (v1.0.0)

[简体中文（默认）](README.md) | **English**

> **Deterministic AI Engineering Gatekeeper & Visual Product Workbench — Zero Runtime Dependencies.**
>
> Replace AI self-reported "all done!" claims with frozen acceptance criteria, tamper-evident SHA-256 evidence chains, independent blind judging (`/donegate-judge`), and an infinite-canvas workbench.

## 1. What DoneGate Solves

1. **Stops False "Done" Claims**: Freezes verifiable acceptance criteria before coding, requires real command/test execution evidence (`0=pass / 1=fail / 2=incident / 3=unknown`), and supports mutation testing (`teeth`) plus independent blind review (`/donegate-judge`).
2. **Prevents Architectural Decay**: Enforces a strictly acyclic layered pyramid (`L0 → L5` 6-layer runtime; `L0 → L7` 8-layer full-repo contract DAG with 0 cycles and 0 facade violations), 4D commit budgets, and full-repo cognitive complexity ≤ 25.
3. **Visual Workbench & Zoom Cockpit**: Offers an offline infinite-canvas Kanban/Workflow/UI Board workbench (`runner/atlas/`) with Louvain adaptive clustering, plus a zero-dependency CLI & stdio MCP Zoom Cockpit (`donegate brief` / `locate` / `zoom --skeleton` / `impact` / `slice` / `lint-edit` / `mcp`).
4. **Python First-Class, Explore Track & Safe Overnight Autopilot**: Ships 33 deterministic tool adapters (including `oxlint`, `shellcheck`, `depcruise`, `ruff`, `ty`, `complexipy`, `import-linter`, `pytest`), OpenSpec dual-track exploration (`contract new --explore` / `promote`), and hybrid Git Worktree parallel + exclusive-resource serial autopilot scheduling.
5. **Measured Graph Navigation (`donegate locate`)**: Combines in-degree-damped CBM weighted-graph Personalized PageRank, Agentless file skeletons (`zoom --skeleton`), and `--budget` caps—achieving `77.5%` Recall@5 across 142 benchmark queries (`+18.3 pp` over `grep` at `59.2%`; `64.7%` on zero-lexical-overlap hidden dependencies vs `5.9%` for `grep`) at `1015.4` avg tokens/query vs `1560.4` for `grep` (`node tools/cockpit-nav-eval.mjs （私有仓）--only grep,fts,locate --k 10` (private repo)).

## 2. Quick Install & Verification

Let your AI coding agent run the one-shot installer and 6-gate anti-lie verification:

```bash
git clone https://github.com/Zegel-None/DoneGate.git
cd DoneGate
node skill/verify-install.mjs --install
```

On Windows, you can also double-click `install-dsh-web.cmd`. Installation is verified only when the receipt prints `RESULT: PASS` and a `DG-INSTALL-OK-...` code.

## 3. Core CLI Commands

```bash
node runner/donegate.mjs brief                       # Zoom-0: layered architecture health, domains & capacity gauges
node runner/donegate.mjs locate "<task>"             # Task-biased CBM PPR file ranking + skeleton summary
node runner/donegate.mjs zoom <01..05|file> --skeleton # Zoom-1/2 on-demand drill-down & Agentless file skeleton
node runner/donegate.mjs impact <file|symbol>        # Cross-file impact radar & multi-hop (<=3) test discovery
node runner/donegate.mjs lint-edit <file...>         # Millisecond single-file syntax/complexity/terminology gate
node runner/donegate.mjs slice <contractId>          # Hermetic subagent context capsule (400k 5-tier budget)
node runner/donegate.mjs mcp                         # Zero-dependency stdio MCP server (dg_brief/locate/zoom/impact)
```

## 4. Architecture Overview (v1.0.0)

| Path | Role |
|---|---|
| `runner/shared/` | **L0** Zero-dependency shared primitives (workbench state, subagent env sanitizer, browser launcher) |
| `runner/core/` | **L1** Headless tamper-evident verdict kernel (12 commands, hermetic slicing, impact radar, CBM bridge) |
| `runner/dsh/deps/` | **L1** Cross-workflow shared dependency pool (`npm-cells/`) & Windows-first path guards |
| `runner/dsh/uiboard/` | **L2** Visual UI Board, aesthetic presets & live browser evaluator |
| `runner/dsh/autopilot/` | **L3** Declarative governance compiler, JIT composer & hybrid Worktree/host autopilot engine |
| `runner/atlas/` | **L4** Infinite-canvas project scanner, Louvain hierarchy & single-file HTML dashboard renderer |
| `runner/cockpit/` · `runner/donegate.mjs` | **L5** CLI composition root, 3-level Zoom Cockpit & stdio MCP server |
| `runner/dsh/host/` | **L5** DSH Web host routes, 256-bit control-plane auth guard & local sync server |
| `skill/check-*.mjs` （私有仓）| **L6** Self-audit hard gates & anti-lie checks |
| `skill/build-*.mjs` （私有仓）· `skill/verify-install.mjs` | **L7** Bundle compiler & 6-gate bare-metal installer verification |
| `donegate/` · `donegate-judge/` · `donegate-forge/` | Three core AI skills: Builder, Blind Judge, and Adapter Forge |
| `skill/adapters/` · `bricks/` · `workflows/` | 33 deterministic external tool adapters, capability manifests & preset workflows |

## 5. Self-Check & Tests

```bash
node skill/check-escapes.mjs --self-check          # Full self-check suite
node skill/check-commit-hygiene.mjs --audit-repo   # Full-repo cognitive complexity (<= 25) & anti-golfing audit
npm install && npm test                            # Run Vitest suite (optional devDependency; runtime is 0-dep)
```

For the complete guide, Vibecoder onboarding, and detailed Chinese documentation, see [README.md](README.md).
