// 驾驶舱全视图 token 预算截断与成本自报包装器（复用 L1 核心门面原语，<= 350 行）
import {
  applyBudget, appendViewCostFooter, estimateTokens, finalizeCliTextView, formatViewWithBudget, parseBudgetOption
} from '../core/index.mjs';

export {
  applyBudget, appendViewCostFooter, estimateTokens, finalizeCliTextView, formatViewWithBudget, parseBudgetOption
};

export function buildZoomExpandHint(targets = [], opts = {}) {
  const parts = ['node runner/donegate.mjs zoom', ...(Array.isArray(targets) ? targets : [])];
  if (opts?.stubs) parts.push('--stubs');
  if (opts?.decisions) parts.push('--decisions');
  if (opts?.full) parts.push('--full');
  if (opts?.skeleton) parts.push('--skeleton');
  if (opts?.source) parts.push('--source');
  if (opts?.trace) parts.push('--trace');
  return parts.join(' ').trim();
}

export function isSingleRulesJsonZoom(targets = [], opts = {}) {
  if (!Array.isArray(targets) || targets.length !== 1) return false;
  const clean = String(targets[0] || '').replace(/^\.\//, '');
  return clean === 'rules' && !opts?.decisions && !opts?.source && !opts?.stubs;
}

export function finalizeZoomCliResult(rawStdout, exitCode, stderr, targets, opts, budgetValue) {
  if (Boolean(opts?.json) || (exitCode === 0 && isSingleRulesJsonZoom(targets, opts))) {
    return stderr ? { exitCode, stdout: rawStdout, stderr } : { exitCode, stdout: rawStdout };
  }
  const view = finalizeCliTextView(rawStdout, budgetValue, buildZoomExpandHint(targets, opts));
  if (!view.ok) return { exitCode: view.exitCode, stderr: view.stderr };
  return stderr ? { exitCode, stdout: view.stdout, stderr } : { exitCode, stdout: view.stdout };
}
