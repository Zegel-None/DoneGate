// 生成符合 DSH dsh-doc 规范的浏览器端模块（挂载 conversation.view + input.dock + input.left + Quote 累加，<= 230 行）
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
      "switch.back": "返回对话",
      "dock.question": "❓ 待你拍板",
      "dock.receipt": "⚡ 完结门回执",
      "dock.fly": "🎯 飞去节点"
    };
    var en = {
      "view.donegate": "DoneGate",
      "switch.label": "⛩ DoneGate",
      "switch.back": "Back to chat",
      "dock.question": "❓ Action needed",
      "dock.receipt": "⚡ DoneGate update",
      "dock.fly": "🎯 Locate node"
    };

    function createDockStore() {
      var state = { items: [], expanded: false };
      var subs = new Set();
      return {
        getSnapshot: function () { return state; },
        subscribe: function (fn) { subs.add(fn); return function () { subs.delete(fn); }; },
        setItems: function (items) {
          state = { items: Array.isArray(items) ? items : [], expanded: state.expanded };
          subs.forEach(function (fn) { try { fn(); } catch (err) { void err; } });
        },
        setExpanded: function (expanded) {
          if (state.expanded === Boolean(expanded)) return;
          state = { items: state.items, expanded: Boolean(expanded) };
          subs.forEach(function (fn) { try { fn(); } catch (err) { void err; } });
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
          } else if (data.type === "dg:dock-sync" && Array.isArray(data.items)) {
            dockStore.setItems(data.items);
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
        var m = bg.match(/\d+/g);
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
      var items = (snap && snap.items) || [];
      if (!items.length) return null;
      var top = items[0];
      var isQuestion = top.kind === "question" || top.kind === "blocked";
      var expanded = Boolean(snap.expanded || isQuestion);

      function flyToNode(nodeId) {
        if (typeof props.activateDoneGateView === "function") props.activateDoneGateView(sessionId);
        var ifr = iframeBySession.get(sessionId);
        if (ifr && ifr.contentWindow) {
          ifr.contentWindow.postMessage({ source: "donegate-host", type: "dg:focus-node", nodeId: nodeId }, "*");
        }
      }

      var borderCol = top.tone === "bad" ? "rgba(239,68,68,0.45)" : (top.tone === "warn" ? "rgba(245,158,11,0.45)" : "rgba(59,130,246,0.38)");
      return h("div", {
        onMouseEnter: function () { dockStore.setExpanded(true); },
        onMouseLeave: function () { if (!isQuestion) dockStore.setExpanded(false); },
        style: {
          width: "100%", boxSizing: "border-box", marginBottom: "6px", padding: expanded ? "8px 12px" : "4px 12px",
          borderRadius: "10px", border: "1px solid " + borderCol,
          background: "var(--dsh-surface-elevated, rgba(22, 24, 29, 0.92))",
          color: "var(--dsh-text-primary, #e5e7eb)", fontSize: "12.5px",
          transition: "all 140ms ease", display: "flex", flexDirection: "column", gap: "6px"
        }
      },
        h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } },
          h("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: expanded ? "normal" : "nowrap", flex: 1 } },
            h("strong", { style: { marginRight: "6px", color: "#93c5fd" } }, isQuestion ? t("dock.question") : t("dock.receipt")),
            String(top.title || "")
          ),
          h("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 } },
            top.targetNodeId ? h("button", {
              type: "button",
              onClick: function () { flyToNode(top.targetNodeId); },
              style: { padding: "2px 8px", borderRadius: "6px", border: "1px solid rgba(147,197,253,0.4)", background: "transparent", color: "#93c5fd", cursor: "pointer", fontSize: "11.5px" }
            }, t("dock.fly")) : null,
            h("button", {
              type: "button",
              onClick: function () { dockStore.setItems(items.slice(1)); },
              style: { padding: "2px 6px", borderRadius: "6px", border: "none", background: "transparent", color: "#9ca3af", cursor: "pointer", fontSize: "12px" }
            }, "×")
          )
        ),
        expanded && items.length > 1 ? h("div", { style: { borderTop: "1px solid rgba(148,163,184,0.16)", paddingTop: "4px", display: "flex", flexDirection: "column", gap: "3px", opacity: 0.82, fontSize: "11.5px" } },
          items.slice(1, 4).map(function (it) { return h("div", { key: it.id }, "· " + String(it.title || "")); })
        ) : null
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
            inject: function () { return { activateDoneGateView: activateDoneGate }; }
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
