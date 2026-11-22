// 生成符合 DSH dsh-doc 与 web-styling/ui-radius 官方规范的浏览器端模块（全屏画布铺底 + 输入框悬浮 + 等宽同材质顶部消息条）
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
      "switch.label": "完结门",
      "switch.back": "切回对话页",
      "dock.bar": "悬停查看对话消息与门禁回执 · 移开自动回到工作台",
      "dock.label": "对话与回执",
      "dock.question": "待确认",
      "dock.receipt": "门禁回执",
      "dock.fly": "定位节点",
      "dock.empty": "当前暂无对话消息，在下方输入框直接发送指令即可驱动工作台。"
    };
    var en = {
      "view.donegate": "DoneGate",
      "switch.label": "DoneGate",
      "switch.back": "Chat view",
      "dock.bar": "Hover to view chat history & gate receipts",
      "dock.label": "Messages",
      "dock.question": "Action needed",
      "dock.receipt": "Receipt",
      "dock.fly": "Locate",
      "dock.empty": "No messages yet. Type below to drive the workbench."
    };

    var HOST_OVERLAY_CSS = [
      "[data-conversation-scroll]:has([data-donegate-overlay]) {",
      "  overflow: hidden !important;",
      "  margin-right: 0 !important;",
      "}",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] {",
      "  background: transparent !important;",
      "  right: 0 !important;",
      "  pointer-events: none !important;",
      "}",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-donegate-dock-wrap],",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-composer-card],",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-composer-dock] > * {",
      "  pointer-events: auto !important;",
      "}"
    ].join("\\n");

    function ensureHostOverlayStyle() {
      if (typeof document === "undefined" || !document.head) return function () {};
      var id = "dsh-donegate-overlay-style";
      var el = document.getElementById(id);
      if (!el) {
        el = document.createElement("style");
        el.id = id;
        el.textContent = HOST_OVERLAY_CSS;
        document.head.appendChild(el);
      }
      return function () {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      };
    }

    function detectDshDarkTheme() {
      if (typeof document === "undefined" || !document.body) return true;
      if (document.body.hasAttribute("data-ds-dark-theme")) return true;
      try {
        var bg = window.getComputedStyle(document.body).backgroundColor || "";
        var m = bg.match(/\\d+/g);
        if (m && m.length >= 3) return (Number(m[0]) + Number(m[1]) + Number(m[2])) < 380;
      } catch (err) { void err; }
      return false;
    }

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
      var initialDarkRef = React.useRef(detectDshDarkTheme());

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

        var obs = null;
        if (typeof MutationObserver === "function" && typeof document !== "undefined" && document.body) {
          obs = new MutationObserver(function () {
            var ifr = frameRef.current;
            if (ifr && ifr.contentWindow) {
              ifr.contentWindow.postMessage({
                source: "donegate-host",
                type: "dg:theme-sync",
                theme: detectDshDarkTheme() ? "dark" : "light"
              }, "*");
            }
          });
          obs.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme", "class", "style"] });
        }

        return function () {
          window.removeEventListener("message", onMessage);
          if (obs) obs.disconnect();
          if (iframeBySession.get(sessionId) === frameRef.current) iframeBySession.delete(sessionId);
        };
      }, [sessionId, inputActions, openRightResource]);

      var src = "/donegate/api/canvas?dsh=1&theme=" + (initialDarkRef.current ? "dark" : "light") + "&sessionId=" + encodeURIComponent(sessionId);
      return h("div", {
        "data-conversation-composer-overlay": "",
        "data-donegate-overlay": "",
        style: {
          position: "relative",
          width: "100%",
          height: "100%",
          flex: "1 1 0%",
          minHeight: "0",
          overflow: "hidden"
        }
      }, h("iframe", {
        ref: frameRef,
        src: src,
        title: "DoneGate V4 Workbench",
        style: { width: "100%", height: "100%", border: "0", display: "block", background: "transparent" }
      }));
    }

    function renderChatGlyph() {
      return h("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", style: { flexShrink: 0, color: "var(--dsw-alias-label-tertiary, #81858c)" } },
        h("path", { d: "M2.5 3.8C2.5 2.97 3.17 2.3 4 2.3h8c.83 0 1.5.67 1.5 1.5v5.4c0 .83-.67 1.5-1.5 1.5H6.4L3.3 13v-2.3H4c-.83 0-1.5-.67-1.5-1.5V3.8Z", stroke: "currentColor", strokeWidth: "1.3", strokeLinejoin: "round" })
      );
    }

    function renderChevronGlyph(open) {
      return h("svg", {
        width: "12", height: "12", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true",
        style: { flexShrink: 0, color: "var(--dsw-alias-label-tertiary, #81858c)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.16s ease" }
      }, h("path", { d: "M4 10L8 6L12 10", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }));
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

      var strokeVar = isQuestion
        ? "var(--dsw-alias-state-warn-primary, rgba(245, 158, 11, 0.55))"
        : "var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.14))";
      var barShadow = "0 0 0 0.5px " + strokeVar + ", 0 4px 16px 0 rgba(0, 0, 0, 0.03), 0 0 24px 0 rgba(0, 0, 0, 0.03)";
      var panelShadow = "0 0 0 0.5px " + strokeVar + ", 0 6px 24px 0 rgba(0, 0, 0, 0.08), 0 0 20px 0 rgba(0, 0, 0, 0.04)";
      var barSummary = top
        ? String(top.title || "")
        : (lastMsg ? ((lastMsg.role === "user" ? "你 · " : "Agent · ") + lastMsg.text) : t("dock.bar"));

      return h("div", {
        "data-donegate-dock-wrap": "",
        onMouseEnter: function (e) {
          if (e && e.pointerType === "touch") return;
          dockStore.setExpanded(true);
        },
        onMouseLeave: function () {
          if (!isQuestion) dockStore.setExpanded(false);
        },
        style: {
          boxSizing: "border-box",
          position: "relative",
          margin: "0 auto",
          width: "calc(100% - 2 * var(--dsh-composer-side-clearance, 16px))",
          maxWidth: "var(--dsh-composer-card-max-width, 760px)",
          fontFamily: "var(--dsw-font-family, inherit)"
        }
      },
        expanded ? h("div", {
          "data-donegate-dock-popout": "",
          style: {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: "100%",
            paddingBottom: "6px",
            zIndex: 60
          }
        }, h("div", {
          style: {
            boxSizing: "border-box",
            maxHeight: "280px",
            overflowY: "auto",
            padding: "12px 14px",
            borderRadius: "var(--dsw-radius-xl, 20px)",
            border: "0",
            background: "var(--dsw-specific-menu, rgba(44, 44, 46, 0.92))",
            backdropFilter: "var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))",
            WebkitBackdropFilter: "var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))",
            boxShadow: panelShadow,
            color: "var(--dsw-alias-label-primary, #f9fafb)",
            fontSize: "13px",
            lineHeight: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }
        },
          h("div", {
            style: {
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
              paddingBottom: "8px", borderBottom: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.14))"
            }
          },
            h("span", { style: { fontWeight: 500, fontSize: "12.5px", color: "var(--dsw-alias-label-secondary, #cfd3d6)" } }, t("dock.label")),
            typeof props.toggleDoneGateView === "function" ? h("button", {
              type: "button",
              onClick: function () { props.toggleDoneGateView(sessionId); },
              style: {
                height: "24px", padding: "0 8px", borderRadius: "var(--dsw-radius-sm, 8px)",
                border: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18))",
                background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08))",
                color: "var(--dsw-alias-label-secondary, #cfd3d6)", cursor: "pointer", fontSize: "12px"
              }
            }, t("switch.back")) : null
          ),
          chatList.length ? h("div", { style: { display: "flex", flexDirection: "column", gap: "6px" } },
            chatList.map(function (m) {
              var isUser = m.role === "user";
              return h("div", {
                key: m.id,
                style: {
                  alignSelf: isUser ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  padding: isUser ? "6px 12px" : "4px 6px",
                  borderRadius: "var(--dsw-radius-lg, 16px)",
                  background: isUser ? "var(--dsw-specific-bubble, rgba(128,128,128,0.14))" : "transparent",
                  color: "var(--dsw-alias-label-primary, #f9fafb)",
                  fontSize: "13px",
                  lineHeight: "20px"
                }
              }, m.text);
            })
          ) : h("div", { style: { color: "var(--dsw-alias-label-tertiary, #81858c)", fontSize: "12.5px", padding: "2px 0" } }, t("dock.empty")),
          items.length ? h("div", {
            style: {
              borderTop: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.14))",
              paddingTop: "8px", display: "flex", flexDirection: "column", gap: "4px"
            }
          },
            items.slice(0, 5).map(function (it) {
              return h("div", {
                key: it.id,
                style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", fontSize: "12.5px", color: "var(--dsw-alias-label-secondary, #cfd3d6)" }
              },
                h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, String(it.title || "")),
                it.targetNodeId ? h("button", {
                  type: "button",
                  onClick: function () { flyToNode(it.targetNodeId); },
                  style: {
                    height: "24px", padding: "0 8px", borderRadius: "var(--dsw-radius-sm, 8px)",
                    border: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18))",
                    background: "transparent", color: "var(--dsw-alias-label-primary, #f9fafb)", cursor: "pointer", fontSize: "11.5px", flexShrink: 0
                  }
                }, t("dock.fly")) : null
              );
            })
          ) : null
        )) : null,
        h("div", {
          "data-donegate-dock-card": "",
          style: {
            boxSizing: "border-box",
            width: "100%",
            minHeight: "36px",
            padding: "6px 12px 6px 14px",
            borderRadius: "var(--dsw-radius-xl, 20px)",
            border: "0",
            background: "var(--dsw-specific-input-major, #2c2c2e)",
            boxShadow: barShadow,
            color: "var(--dsw-alias-label-secondary, #cfd3d6)",
            fontSize: "13px",
            lineHeight: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            cursor: "pointer"
          }
        },
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 } },
            renderChatGlyph(),
            h("span", { style: { fontWeight: 500, color: "var(--dsw-alias-label-primary, #f9fafb)", flexShrink: 0 } },
              top ? (isQuestion ? t("dock.question") : t("dock.receipt")) : t("dock.label")
            ),
            h("span", {
              style: {
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: "var(--dsw-alias-label-tertiary, #81858c)", flex: 1, minWidth: 0
              }
            }, barSummary)
          ),
          h("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 } },
            top && top.targetNodeId ? h("button", {
              type: "button",
              onClick: function () { flyToNode(top.targetNodeId); },
              style: {
                height: "24px", padding: "0 8px", borderRadius: "var(--dsw-radius-sm, 8px)",
                border: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18))",
                background: "transparent", color: "var(--dsw-alias-label-secondary, #cfd3d6)", cursor: "pointer", fontSize: "12px"
              }
            }, t("dock.fly")) : null,
            top ? h("button", {
              type: "button",
              onClick: function () { dockStore.setItems(items.slice(1), syncedMsgs); },
              style: {
                width: "24px", height: "24px", borderRadius: "var(--dsw-radius-sm, 8px)",
                border: "none", background: "transparent", color: "var(--dsw-alias-label-tertiary, #81858c)", cursor: "pointer", fontSize: "14px"
              }
            }, "×") : renderChevronGlyph(expanded)
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
          display: "inline-flex", alignItems: "center", gap: "5px",
          height: "28px", padding: "0 10px", boxSizing: "border-box",
          borderRadius: "var(--dsw-radius-sm, 8px)",
          border: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.16))",
          background: "transparent",
          color: "var(--dsw-alias-label-secondary, inherit)",
          fontFamily: "var(--dsw-font-family, inherit)",
          fontSize: "12.5px", fontWeight: 500, cursor: "pointer", lineHeight: "20px"
        }
      },
        h("svg", { width: "13", height: "13", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
          h("path", { d: "M2.5 5.2h11M4.2 5.2v7.3M11.8 5.2v7.3M2 3.2h12", stroke: "currentColor", strokeWidth: "1.35", strokeLinecap: "round" })
        ),
        t("switch.label")
      );
    }

    return {
      inject: ["slots", "locale"],
      apply: function apply(ctx) {
        ctx.effect(function () { return ensureHostOverlayStyle(); }, "dsh-donegate: overlay-css");
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
