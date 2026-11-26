# DoneGate (v1.0.0)

[简体中文（默认）](README.md) | **English**

> **Deterministic AI Engineering Gatekeeper & Visual Product Workbench — Zero Runtime Dependencies.**
>
> Replace AI self-reported "all done!" claims with frozen acceptance criteria, tamper-evident SHA-256 evidence chains, independent blind judging (`/donegate-judge`), and an infinite-canvas workbench.

## 1. What DoneGate Solves

1. **Stops False "Done" Claims**: Freezes verifiable acceptance criteria before coding, requires real command/test execution evidence (`0=pass / 1=fail / 2=incident / 3=unknown`), and supports mutation testing (`teeth`) plus independent blind review (`/donegate-judge`).
2. **Prevents Architectural Decay**: Enforces a strictly acyclic layered pyramid (`L0 → L7`, 0 cycles, 0 facade violations), 4D commit budgets, and full-repo cognitive complexity ≤ 25.
3. **Visual Workbench & Zoom Cockpit**: Offers an offline infinite-canvas Kanban/Workflow/UI Board workbench (`runner/atlas/`) with Louvain adaptive clustering, plus a zero-dependency CLI Zoom Cockpit (`donegate brief` / `zoom` / `impact` / `slice` / `lint-edit`).
4. **Python First-Class, Explore Track & Safe Overnight Autopilot**: Ships 31 deterministic tool adapters (including `ruff`, `ty`, `complexipy`, `import-linter`, `pytest`), OpenSpec dual-track exploration (`contract new --explore` / `promote`), and hybrid Git Worktree parallel + exclusive-resource serial autopilot scheduling.

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
node runner/donegate.mjs brief                     # Zoom-0: layered architecture health, domains & capacity gauges
node runner/donegate.mjs graph                     # Layered Mermaid dependency pyramid + 3-color edge audit
node runner/donegate.mjs zoom <01..05|file|rules>  # Zoom-1/2 on-demand drill-down
node runner/donegate.mjs impact <file|symbol>      # Cross-file impact radar & 1-hop test discovery
node runner/donegate.mjs lint-edit <file...>       # Millisecond single-file syntax/complexity/terminology gate
node runner/donegate.mjs slice <contractId>        # Hermetic subagent context capsule (400k 5-tier budget)
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
| `runner/cockpit/` · `runner/donegate.mjs` | **L5** CLI composition root & 3-level Zoom Cockpit |
| `runner/dsh/host/` | **L5** DSH Web host routes, 256-bit control-plane auth guard & local sync server |
| `donegate/` · `donegate-judge/` · `donegate-forge/` | Three core AI skills: Builder, Blind Judge, and Adapter Forge |
| `skill/adapters/` · `bricks/` · `workflows/` | 31 deterministic external tool adapters, capability manifests & preset workflows |

## 5. Self-Check & Tests

```bash
node skill/check-escapes.mjs --self-check          # Full self-check suite
node skill/check-commit-hygiene.mjs --audit-repo   # Full-repo cognitive complexity (<= 25) & anti-golfing audit
npm install && npm test                            # Run Vitest suite (optional devDependency; runtime is 0-dep)
```

For the complete guide, Vibecoder onboarding, and detailed Chinese documentation, see [README.md](README.md).
