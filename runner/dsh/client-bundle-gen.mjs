// 生成符合 DSH dsh-doc 规范的浏览器端模块（挂载 conversation.view + input.dock 悬停弹出聊天记录窗 + input.left + Quote 累加）
import { DSH_BUNDLE_NAME } from './bundle-templates.mjs';

export function renderDshClientBundleJs() {
  return `window.__ModuleLoader__.load({
  id: ${JSON.stringify(DSH_BUNDLE_NAME)},
  factory(require) {
    var React = require("react");
    var h = React.createElement;

    var NS = "dshDonegate";
    var zh = {
      "view.donegate": "完结门",
      "switch.label": "⛩ 完结门",
      "switch.back": "↗ 切回全屏对话",
      "dock.bar": "💬 对话记录与回执栏（鼠标移入弹出聊天窗口 · 移开自动回到工作台）",
      "dock.question": "❓ 待你拍板",
      "dock.receipt": "⚡ 完结门回执",
      "dock.fly": "🎯 飞去节点",
      "dock.empty": "暂无历史对话消息，直接在下方原生输入框发指令即可驱动工作台。"
    };
    var en = {
      "view.donegate": "DoneGate",
      "switch.label": "⛩ DoneGate",
      "switch.back": "↗ Full chat view",
      "dock.bar": "💬 Chat history & receipts (hover to pop out · leave to return)",
      "dock.question": "❓ Action needed",
      "dock.receipt": "⚡ DoneGate update",
      "dock.fly": "🎯 Locate node",
      "dock.empty": "No messages yet. Type in the chat box below to drive the workbench."
    };

    function createDockStore() {
      var state = { items: [], messages: [], expanded: false };
      var subs = new Set();
      function emit() { subs.forEach(function (fn) { try { fn(); } catch (err) { void err; } }); }
      return {
        getSnapshot: function () { return state; },
        subscribe: function (fn) { subs.add(fn); return function () { subs.delete(fn); }; },
        setItems: function (items, messages) {
          state = {
            items: Array.isArray(items) ? items : state.items,
            messages: Array.isArray(messages) ? messages : state.messages,
            expanded: state.expanded
          };
          emit();
        },
        setExpanded: function (expanded) {
          if (state.expanded === Boolean(expanded)) return;
          state = { items: state.items, messages: state.messages, expanded: Boolean(expanded) };
          emit();
        }
      };
    }

    var dockStore = createDockStore();
    var iframeBySession = new Map();

    function resolveSessionId(props) {
      if (props && typeof props.useSession === "function") {
        var sid = props.useSession(function (s) { return s && s.id; });
        if (sid) return String(sid);
      }
      if (props && props.session && props.session.id) return String(props.session.id);
      if (props && props.sessionId) return String(props.sessionId);
      return "default";
    }

    function resolveSessionMessages(props) {
      var raw = null;
      if (props && typeof props.useSession === "function") {
        try {
          raw = props.useSession(function (s) { return s && (s.messages || s.turns || s.items); });
        } catch (err) { void err; }
      }
      if (!raw && props && props.session) {
        raw = props.session.messages || props.session.turns || props.session.items;
      }
      if (!Array.isArray(raw)) return [];
      return raw.slice(-16).map(function (m, idx) {
        var role = (m && (m.role || m.sender)) || "assistant";
        var text = typeof (m && m.content) === "string"
          ? m.content
          : (Array.isArray(m && m.content)
              ? m.content.map(function (p) { return (p && (p.text || p.content)) || ""; }).join(" ")
              : String((m && (m.text || m.summary || "")) || ""));
        return { id: String((m && m.id) || ("msg-" + idx)), role: String(role), text: text.trim() };
      }).filter(function (m) { return Boolean(m.text); });
    }

    function DoneGateCanvasView(props) {
      var sessionId = resolveSessionId(props);
      var inputActions = props.inputActions;
      var openRightResource = props.openRightResource;
      var frameRef = React.useRef(null);

      React.useEffect(function () {
        if (frameRef.current) iframeBySession.set(sessionId, frameRef.current);
        function onMessage(ev) {
          var data = ev && ev.data;
          if (!data || typeof data !== "object" || data.source !== "donegate-canvas") return;
          if (data.sessionId && data.sessionId !== sessionId) return;
          if (data.type === "dg:insert-quote" && inputActions && typeof inputActions.insertQuote === "function") {
            var ok = inputActions.insertQuote(String(data.text || ""), data.summary);
            if (ok && typeof inputActions.focus === "function") inputActions.focus();
          } else if (data.type === "dg:open-right-file" && typeof openRightResource === "function" && data.address) {
            openRightResource(String(data.address));
          } else if (data.type === "dg:dock-sync") {
            dockStore.setItems(data.items, data.messages);
          }
        }
        window.addEventListener("message", onMessage);
        return function () {
          window.removeEventListener("message", onMessage);
          if (iframeBySession.get(sessionId) === frameRef.current) iframeBySession.delete(sessionId);
        };
      }, [sessionId, inputActions, openRightResource]);

      var isDarkHost = true;
      try {
        var bg = window.getComputedStyle(document.body).backgroundColor || "";
        var m = bg.match(/\\d+/g);
        if (m && m.length >= 3) isDarkHost = (Number(m[0]) + Number(m[1]) + Number(m[2])) < 380;
      } catch (err) { void err; }
      var src = "/donegate/api/canvas?dsh=1&theme=" + (isDarkHost ? "dark" : "light") + "&sessionId=" + encodeURIComponent(sessionId);
      return h("div", {
        style: {
          width: "100%",
          height: "calc(var(--dsh-conversation-viewport-height, 78vh) - var(--dsh-composer-height, 118px) - 8px)",
          minHeight: "420px",
          position: "relative",
          overflow: "hidden",
          borderRadius: "10px"
        }
      }, h("iframe", {
        ref: frameRef,
        src: src,
        title: "DoneGate V4 Workbench",
        style: { width: "100%", height: "100%", border: "0", display: "block", background: "transparent" }
      }));
    }

    function DoneGateInputDock(props) {
      var sessionId = resolveSessionId(props);
      var t = props.t || function (k) { return zh[k] || k; };
      var snap = React.useSyncExternalStore
        ? React.useSyncExternalStore(dockStore.subscribe, dockStore.getSnapshot, dockStore.getSnapshot)
        : dockStore.getSnapshot();
      var hostMsgs = resolveSessionMessages(props);
      var items = (snap && snap.items) || [];
      var syncedMsgs = (snap && snap.messages) || [];
      var chatList = hostMsgs.length ? hostMsgs : syncedMsgs;
      var isDoneGateActive = typeof props.isDoneGateActive === "function" ? props.isDoneGateActive(sessionId) : true;
      if (!isDoneGateActive && !items.length) return null;

      var top = items[0] || null;
      var lastMsg = chatList.length ? chatList[chatList.length - 1] : null;
      var isQuestion = Boolean(top && (top.kind === "question" || top.kind === "blocked"));
      var expanded = Boolean((snap && snap.expanded) || isQuestion);

      function flyToNode(nodeId) {
        if (typeof props.activateDoneGateView === "function") props.activateDoneGateView(sessionId);
        var ifr = iframeBySession.get(sessionId);
        if (ifr && ifr.contentWindow) {
          ifr.contentWindow.postMessage({ source: "donegate-host", type: "dg:focus-node", nodeId: nodeId }, "*");
        }
      }

      var borderCol = top && top.tone === "bad"
        ? "rgba(239,68,68,0.45)"
        : (isQuestion ? "rgba(245,158,11,0.55)" : "rgba(59,130,246,0.38)");
      var barHeadline = top
        ? String(top.title || "")
        : (lastMsg ? ((lastMsg.role === "user" ? "你：" : "Agent：") + lastMsg.text) : t("dock.bar"));

      return h("div", {
        onMouseEnter: function () { dockStore.setExpanded(true); },
        onMouseLeave: function () { if (!isQuestion) dockStore.setExpanded(false); },
        style: { position: "relative", width: "100%", boxSizing: "border-box", marginBottom: "6px" }
      },
        expanded ? h("div", {
          style: {
            position: "absolute", left: 0, right: 0, bottom: "calc(100% + 4px)", zIndex: 60,
            maxHeight: "300px", overflowY: "auto", padding: "10px 12px", borderRadius: "12px",
            border: "1px solid " + borderCol,
            background: "var(--dsh-surface-elevated, rgba(17, 20, 27, 0.97))",
            boxShadow: "0 -10px 28px rgba(0,0,0,0.34)",
            color: "var(--dsh-text-primary, #e5e7eb)", fontSize: "12px",
            display: "flex", flexDirection: "column", gap: "8px"
          }
        },
          h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(148,163,184,0.18)", paddingBottom: "6px" } },
            h("strong", { style: { color: "#93c5fd", fontSize: "12px" } }, "💬 最近对话记录与门禁回执（移开鼠标自动收起回工作台）"),
            typeof props.toggleDoneGateView === "function" ? h("button", {
              type: "button",
              onClick: function () { props.toggleDoneGateView(sessionId); },
              style: { padding: "2px 8px", borderRadius: "6px", border: "1px solid rgba(147,197,253,0.35)", background: "transparent", color: "#93c5fd", cursor: "pointer", fontSize: "11px" }
            }, t("switch.back")) : null
          ),
          chatList.length ? h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            chatList.map(function (m) {
              var isUser = m.role === "user";
              return h("div", {
                key: m.id,
                style: {
                  alignSelf: isUser ? "flex-end" : "flex-start", maxWidth: "88%",
                  padding: "6px 10px", borderRadius: "9px", lineHeight: "1.45",
                  background: isUser ? "rgba(37,99,235,0.22)" : "rgba(148,163,184,0.12)",
                  border: isUser ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(148,163,184,0.2)"
                }
              }, h("span", { style: { fontWeight: 700, marginRight: "6px", color: isUser ? "#93c5fd" : "#a7f3d0" } }, isUser ? "你" : "Agent"), m.text);
            })
          ) : h("div", { style: { opacity: 0.72, fontSize: "11.5px" } }, t("dock.empty")),
          items.length ? h("div", { style: { borderTop: "1px solid rgba(148,163,184,0.16)", paddingTop: "6px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "11.5px" } },
            items.slice(0, 6).map(function (it) {
              return h("div", { key: it.id, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } },
                h("span", null, "⚡ " + String(it.title || "")),
                it.targetNodeId ? h("button", {
                  type: "button",
                  onClick: function () { flyToNode(it.targetNodeId); },
                  style: { padding: "1px 7px", borderRadius: "6px", border: "1px solid rgba(147,197,253,0.35)", background: "transparent", color: "#93c5fd", cursor: "pointer", fontSize: "11px" }
                }, t("dock.fly")) : null
              );
            })
          ) : null
        ) : null,
        h("div", {
          style: {
            width: "100%", boxSizing: "border-box", padding: "4px 12px",
            borderRadius: "10px", border: "1px solid " + borderCol,
            background: "var(--dsh-surface-elevated, rgba(22, 24, 29, 0.92))",
            color: "var(--dsh-text-primary, #e5e7eb)", fontSize: "12px",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", cursor: "pointer"
          }
        },
          h("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 } },
            h("strong", { style: { marginRight: "6px", color: "#93c5fd" } }, top ? (isQuestion ? t("dock.question") : t("dock.receipt")) : "💬 聊天窗"),
            barHeadline
          ),
          h("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 } },
            top && top.targetNodeId ? h("button", {
              type: "button",
              onClick: function () { flyToNode(top.targetNodeId); },
              style: { padding: "2px 8px", borderRadius: "6px", border: "1px solid rgba(147,197,253,0.4)", background: "transparent", color: "#93c5fd", cursor: "pointer", fontSize: "11.5px" }
            }, t("dock.fly")) : null,
            top ? h("button", {
              type: "button",
              onClick: function () { dockStore.setItems(items.slice(1), syncedMsgs); },
              style: { padding: "2px 6px", borderRadius: "6px", border: "none", background: "transparent", color: "#9ca3af", cursor: "pointer", fontSize: "12px" }
            }, "×") : h("span", { style: { fontSize: "11px", opacity: 0.72 } }, "▲ 悬停看对话")
          )
        )
      );
    }

    function DoneGateQuickSwitch(props) {
      var sessionId = resolveSessionId(props);
      var t = props.t || function (k) { return zh[k] || k; };
      if (typeof props.toggleDoneGateView !== "function") return null;
      return h("button", {
        type: "button",
        onClick: function () { props.toggleDoneGateView(sessionId); },
        style: {
          padding: "2px 8px", borderRadius: "999px", border: "1px solid rgba(59,130,246,0.35)",
          background: "rgba(36,123,191,0.12)", color: "inherit", fontSize: "11.5px", cursor: "pointer", lineHeight: "18px"
        }
      }, t("switch.label"));
    }

    return {
      inject: ["slots", "locale"],
      apply: function apply(ctx) {
        ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "dsh-donegate: locale");
        var t = ctx.locale.bind(NS);

        function activateDoneGate(sid) {
          var uic = ctx.get && ctx.get("uiConversation");
          if (uic && typeof uic.binding === "function" && sid && sid !== "default") {
            try { uic.binding(sid).activate("donegate"); } catch (err) { void err; }
          }
        }

        function isDoneGateActive(sid) {
          var uic = ctx.get && ctx.get("uiConversation");
          if (uic && typeof uic.binding === "function" && sid && sid !== "default") {
            try {
              var b = uic.binding(sid);
              return (b.store && b.store.getSnapshot ? b.store.getSnapshot().view : "donegate") === "donegate";
            } catch (err) { void err; }
          }
          return true;
        }

        function toggleDoneGate(sid) {
          var uic = ctx.get && ctx.get("uiConversation");
          if (uic && typeof uic.binding === "function" && sid && sid !== "default") {
            try {
              var b = uic.binding(sid);
              var cur = b.store && b.store.getSnapshot ? b.store.getSnapshot().view : null;
              b.activate(cur === "donegate" ? "chat" : "donegate");
            } catch (err) { void err; }
          }
        }

        ctx.slots.inject("conversation.view", function () {
          return ctx.slots.register({
            name: "conversation.view",
            id: "donegate",
            order: 1,
            locale: NS,
            label: function () { return t("view.donegate"); },
            inject: function () {
              return {
                openRightResource: function (addr) {
                  var sr = ctx.get && ctx.get("sidebarRight");
                  if (sr && typeof sr.openResource === "function") sr.openResource(addr, { preferNewPane: false });
                }
              };
            }
          }, DoneGateCanvasView);
        });

        ctx.slots.inject("conversation.input.dock", function () {
          return ctx.slots.register({
            name: "conversation.input.dock",
            id: "donegate-dock",
            order: 5,
            locale: NS,
            inject: function () {
              return {
                activateDoneGateView: activateDoneGate,
                isDoneGateActive: isDoneGateActive,
                toggleDoneGateView: toggleDoneGate
              };
            }
          }, DoneGateInputDock);
        });

        ctx.slots.inject("conversation.input.left", function () {
          return ctx.slots.register({
            name: "conversation.input.left",
            id: "donegate-switch",
            order: 35,
            locale: NS,
            inject: function () { return { toggleDoneGateView: toggleDoneGate }; }
          }, DoneGateQuickSwitch);
        });
      }
    };
  }
});
`;
}
