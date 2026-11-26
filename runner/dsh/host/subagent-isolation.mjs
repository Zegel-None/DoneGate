// DSH 子智能体与人类用户双层隔离守卫：前端 conversation.composer 只读槽位接管 + 宿主端浏览器直发 RPC 拦截（100% 保留主控 send_message 续调）

export const SUBAGENT_HUMAN_ISOLATION_MSG =
  '完结门子智能体为只读执行工兵，仅接受主对话契约调度（send_message），请返回主对话下达指令。';

const GUARD_INSTALLED_SYM = Symbol.for('donegate.subagentHumanIsolationGuard');

function isHumanSubagentPromptAllowed(opts = {}) {
  if (opts && opts.allowHumanPrompt === true) return true;
  const env = (opts && opts.env) || process.env;
  return String(env?.DG_ALLOW_HUMAN_SUBAGENT_PROMPT || '').trim() === '1';
}

export function createSubagentHumanBlockedError(childSessionId = '') {
  const err = new Error(SUBAGENT_HUMAN_ISOLATION_MSG);
  err.name = 'RemoteError';
  err.code = 'subagent/not-resumable';
  err.details = childSessionId ? { sessionId: String(childSessionId) } : {};
  return err;
}

export function installSubagentHumanIsolationGuard(subagentsSvc, opts = {}) {
  if (!subagentsSvc || typeof subagentsSvc.prompt !== 'function') {
    return function noopDispose() {};
  }
  if (subagentsSvc[GUARD_INSTALLED_SYM]) {
    return subagentsSvc[GUARD_INSTALLED_SYM];
  }
  const origPrompt = subagentsSvc.prompt;
  const wrappedPrompt = async function guardedSubagentHumanPrompt(request, signal) {
    if (isHumanSubagentPromptAllowed(opts)) {
      return origPrompt.call(this, request, signal);
    }
    const targetId = request && typeof request === 'object' ? request.childSessionId : '';
    throw createSubagentHumanBlockedError(targetId);
  };
  subagentsSvc.prompt = wrappedPrompt;
  const dispose = function restoreSubagentHumanPrompt() {
    if (subagentsSvc.prompt === wrappedPrompt) {
      subagentsSvc.prompt = origPrompt;
    }
    delete subagentsSvc[GUARD_INSTALLED_SYM];
  };
  Object.defineProperty(subagentsSvc, GUARD_INSTALLED_SYM, {
    value: dispose,
    configurable: true,
    enumerable: false
  });
  return dispose;
}

export function buildClientSubagentReadOnlyComposerSource() {
  return String.raw`
    function selectDoneGateReadOnlySubagent(owner) {
      var sub = owner && owner.session && owner.session.subagent;
      if (sub === undefined || sub === null) return null;
      var addr = sub.address || {};
      return {
        parentSessionId: addr.parentSessionId ? String(addr.parentSessionId) : "",
        mode: addr.mode ? String(addr.mode) : "continuable"
      };
    }

    function DoneGateSubagentReadOnlyComposer(props) {
      var t = props && typeof props.t === "function" ? props.t : function (k) { return k; };
      var matched = (props && props.matched) || {};
      var parentId = matched.parentSessionId || "";
      var canJumpParent = Boolean(parentId && props && typeof props.openParentSession === "function");
      return h("div", {
        role: "status",
        "data-donegate-subagent-readonly": "1",
        style: {
          width: "100%",
          maxWidth: "760px",
          margin: "0 auto 10px",
          padding: "11px 16px",
          borderRadius: "18px",
          background: "var(--dsw-specific-input-major, #2c2c2e)",
          border: "0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.24))",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          pointerEvents: "auto"
        }
      },
        h("div", {
          style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 0%" }
        },
          h("strong", {
            style: {
              fontSize: "12.5px",
              fontWeight: 600,
              color: "var(--dsw-alias-label-primary, #f9fafb)"
            }
          }, t("readonly.dgTitle")),
          h("span", {
            style: {
              fontSize: "12px",
              lineHeight: "18px",
              color: "var(--dsw-alias-label-secondary, #cfd3d6)"
            }
          }, t("readonly.dgBody"))
        ),
        canJumpParent ? h("button", {
          type: "button",
          "data-donegate-back-parent": parentId,
          onClick: function () { props.openParentSession(parentId); },
          style: {
            flexShrink: 0,
            height: "28px",
            padding: "0 12px",
            borderRadius: "999px",
            border: "0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.32))",
            background: "var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.16))",
            color: "var(--dsw-alias-label-primary, #f9fafb)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap"
          }
        }, t("readonly.dgBackParent")) : null
      );
    }
`;
}
