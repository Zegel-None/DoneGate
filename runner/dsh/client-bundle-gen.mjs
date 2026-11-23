// 生成符合 DSH 官方规范的浏览器端模块总装入口（组合全屏画布、会话消息提取器与卡包抽卡式对话抽屉）
import { DSH_BUNDLE_NAME } from './bundle-templates.mjs';
import { buildDshClientChatExtractSource } from './client-chat-extract.mjs';
import { buildDshClientDockViewSource } from './client-dock-view.mjs';

function buildClientHeaderSource() {
  return String.raw`
    var React = require("react");
    var h = React.createElement;

    var NS = "dshDonegate";
    var TUCK_OVERLAP_PX = 28;
    var COLLAPSED_LIP_PX = 34;
    var DEFAULT_EXPANDED_PX = 280;
    var MIN_EXPANDED_PX = 128;
    var MAX_EXPANDED_PX = 680;

    var STORAGE_KEYS = {
      agentName: "dg_dsh_agent_name",
      pinned: "dg_dsh_dock_pinned",
      height: "dg_dsh_dock_height"
    };

    var zh = {
      "view.donegate": "完结门",
      "switch.label": "完结门",
      "dock.pin": "固定",
      "dock.pinned": "已固定",
      "dock.waiting": "等待新消息…",
      "dock.empty": "暂无历史对话，直接在下方输入框发送消息即可开始协作。",
      "dock.renameTip": "双击可修改 Agent 称呼（回车保存）",
      "dock.resizeTip": "上下拖动调整窗口高度（自动记忆）",
      "dock.fly": "定位节点",
      "dock.thinking": "思考过程"
    };
    var en = {
      "view.donegate": "DoneGate",
      "switch.label": "DoneGate",
      "dock.pin": "Pin",
      "dock.pinned": "Pinned",
      "dock.waiting": "Waiting for reply…",
      "dock.empty": "No conversation history yet. Send a message below to start.",
      "dock.renameTip": "Double-click to rename Agent",
      "dock.resizeTip": "Drag to resize height (auto-saved)",
      "dock.fly": "Locate",
      "dock.thinking": "Reasoning"
    };
`;
}

function buildHostOverlayCssSource() {
  return String.raw`
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
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-composer-dock] > *,",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-slot='conversation.composer'] > :not([data-chain-overlay-fallback]):not([data-question-key]):not([data-plan-review-key]):not([data-approval-key]) {",
      "  pointer-events: auto !important;",
      "}",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-slot='conversation.composer'] > :not([data-chain-overlay-fallback]) {",
      "  position: relative !important;",
      "  z-index: 6 !important;",
      "}",
      "/* 主对话发来选择框/计划评审/权限审批接管时：外层全宽居中框透传两侧画布拖拽，内层卡片 100% 恢复点击与最高层级 */",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-slot='conversation.composer'] [data-question-key],",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-slot='conversation.composer'] [data-plan-review-key],",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-slot='conversation.composer'] [data-approval-key] {",
      "  position: relative !important;",
      "  z-index: 6 !important;",
      "  pointer-events: none !important;",
      "}",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-question-key] > *,",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-plan-review-key] > *,",
      "[data-conversation-scroll]:has([data-donegate-overlay]) > [data-composer-seat] [data-approval-key] > * {",
      "  pointer-events: auto !important;",
      "}",
      "/* 卡包抽卡叠压层次：抽屉卡在 z-index:1，下方原生输入框在 z-index:4，上圆角自然压住抽屉底边零缝隙 */",
      "[data-conversation-scroll]:has([data-donegate-overlay]) [data-composer-seat] [data-slot='conversation.input.dock'],",
      "[data-conversation-scroll]:has([data-donegate-overlay]) [data-composer-seat] [data-donegate-dock-wrap] {",
      "  position: relative !important;",
      "  z-index: 1 !important;",
      "}",
      "[data-conversation-scroll]:has([data-donegate-overlay]) [data-composer-seat] :has(> [data-composer-card]) {",
      "  position: relative !important;",
      "  z-index: 4 !important;",
      "}",
      "[data-conversation-scroll]:has([data-donegate-overlay]) [data-composer-seat] [data-composer-card] {",
      "  position: relative !important;",
      "  z-index: 4 !important;",
      "  background: var(--dsw-specific-input-major, #2c2c2e) !important;",
      "  box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22)), 0 -5px 14px rgba(0, 0, 0, 0.18), 0 4px 16px rgba(0, 0, 0, 0.04) !important;",
      "}",
      "@keyframes dgCardMsgPop {",
      "  from { opacity: 0; transform: translateY(7px); }",
      "  to { opacity: 1; transform: translateY(0); }",
      "}",
      "@keyframes dgCardMarquee {",
      "  0%, 16% { transform: translateX(0); }",
      "  84%, 100% { transform: translateX(var(--dg-marquee-shift, -42%)); }",
      "}",
      "[data-donegate-msg-pop] {",
      "  animation: dgCardMsgPop 0.22s cubic-bezier(0.22, 1, 0.36, 1);",
      "}",
      "[data-donegate-marquee='1'] {",
      "  display: inline-block;",
      "  padding-right: 36px;",
      "  animation: dgCardMarquee var(--dg-marquee-dur, 11s) linear infinite alternate;",
      "}",
      "[data-donegate-dock-wrap]:hover [data-donegate-marquee='1'] {",
      "  animation-play-state: paused;",
      "}",
      "[data-donegate-chat-scroll]::-webkit-scrollbar { width: 5px; height: 5px; }",
      "[data-donegate-chat-scroll]::-webkit-scrollbar-track { background: transparent; margin: 6px 0; }",
      "[data-donegate-chat-scroll]::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l2, rgba(128, 128, 128, 0.28)); border-radius: 999px; }",
      "[data-donegate-chat-scroll]::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l2, rgba(128, 128, 128, 0.44)); }",
      "[data-donegate-resize-bar]:hover [data-donegate-resize-pill] { opacity: 0.72 !important; width: 42px !important; }"
    ].join("\n");
`;
}

function buildClientDockStoreSource() {
  return String.raw`
    function readLocalPref(key, fallbackVal) {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          var v = window.localStorage.getItem(key);
          if (v !== null && v !== undefined && v !== "") return v;
        }
      } catch (err) { void err; }
      return fallbackVal;
    }

    function writeLocalPref(key, val) {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem(key, String(val));
        }
      } catch (err) { void err; }
    }

    function clampHeight(rawH) {
      var n = Number(rawH);
      if (!n || isNaN(n)) return DEFAULT_EXPANDED_PX;
      var maxWin = (typeof window !== "undefined" && window.innerHeight) ? Math.max(200, Math.round(window.innerHeight * 0.72)) : MAX_EXPANDED_PX;
      return Math.max(MIN_EXPANDED_PX, Math.min(Math.min(MAX_EXPANDED_PX, maxWin), Math.round(n)));
    }

    function ensureHostOverlayStyle() {
      if (typeof document === "undefined" || !document.head) return function () {};
      var id = "dsh-donegate-overlay-style";
      var el = document.getElementById(id);
      if (!el) {
        el = document.createElement("style");
        el.id = id;
        el.textContent = HOST_OVERLAY_CSS;
        document.head.appendChild(el);
      } else {
        el.textContent = HOST_OVERLAY_CSS;
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
        var m = bg.match(/\d+/g);
        if (m && m.length >= 3) return (Number(m[0]) + Number(m[1]) + Number(m[2])) < 380;
      } catch (err) { void err; }
      return false;
    }

    function createDockStore() {
      var initPinned = readLocalPref(STORAGE_KEYS.pinned, "0") === "1";
      var state = {
        items: [],
        messages: [],
        hovered: false,
        pinned: initPinned,
        height: clampHeight(readLocalPref(STORAGE_KEYS.height, String(DEFAULT_EXPANDED_PX))),
        agentName: String(readLocalPref(STORAGE_KEYS.agentName, "Agent") || "Agent").trim() || "Agent"
      };
      var subs = new Set();
      function emit() { subs.forEach(function (fn) { try { fn(); } catch (err) { void err; } }); }
      return {
        getSnapshot: function () { return state; },
        subscribe: function (fn) { subs.add(fn); return function () { subs.delete(fn); }; },
        setItems: function (items, messages) {
          state = Object.assign({}, state, {
            items: Array.isArray(items) ? items : state.items,
            messages: Array.isArray(messages) ? messages : state.messages
          });
          emit();
        },
        setHovered: function (hovered) {
          var next = Boolean(hovered);
          if (state.hovered === next) return;
          state = Object.assign({}, state, { hovered: next });
          emit();
        },
        togglePinned: function () {
          var next = !state.pinned;
          writeLocalPref(STORAGE_KEYS.pinned, next ? "1" : "0");
          state = Object.assign({}, state, { pinned: next });
          emit();
        },
        setHeight: function (nextH) {
          var clamped = clampHeight(nextH);
          if (state.height === clamped) return;
          writeLocalPref(STORAGE_KEYS.height, String(clamped));
          state = Object.assign({}, state, { height: clamped });
          emit();
        },
        setAgentName: function (rawName) {
          var clean = String(rawName || "").trim().slice(0, 24) || "Agent";
          writeLocalPref(STORAGE_KEYS.agentName, clean);
          state = Object.assign({}, state, { agentName: clean });
          emit();
        }
      };
    }

    var dockStore = createDockStore();
    var iframeBySession = new Map();

    function resolveSessionId(props) {
      if (props && typeof props.useSession === "function") {
        try {
          var sid = props.useSession(function (s) { return s && s.id; });
          if (sid) return String(sid);
        } catch (err) { void err; }
      }
      if (props && props.session && props.session.id) return String(props.session.id);
      if (props && props.sessionId) return String(props.sessionId);
      return "default";
    }
`;
}

function buildClientCanvasViewSource() {
  return String.raw`
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
          } else if (data.type === "dg:dispatch-subagent") {
            if (data.prompt && inputActions && typeof inputActions.setDraft === "function" && typeof inputActions.submit === "function") {
              inputActions.setDraft(String(data.prompt));
              inputActions.submit();
            }
          } else if (data.type === "dg:open-right-file" && typeof openRightResource === "function" && data.address) {
            openRightResource(String(data.address));
          } else if (data.type === "dg:dock-sync") {
            dockStore.setItems(data.items, data.messages);
          } else if (data.type === "dg:set-agent-name" && data.agentName) {
            dockStore.setAgentName(data.agentName);
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
`;
}

function buildClientSlotsPluginSource() {
  return String.raw`
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
          if (!sid || sid === "default") return false;
          var uic = ctx.get && ctx.get("uiConversation");
          if (!uic || typeof uic.binding !== "function") return false;
          try {
            var b = uic.binding(sid);
            var view = (b && b.store && typeof b.store.getSnapshot === "function" && b.store.getSnapshot())
              ? (b.store.getSnapshot().view || "chat")
              : "chat";
            return view === "donegate";
          } catch (err) {
            void err;
            return false;
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
            order: 85,
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
`;
}

export function renderDshClientBundleJs() {
  const body = [
    buildClientHeaderSource(),
    buildHostOverlayCssSource(),
    buildClientDockStoreSource(),
    buildDshClientChatExtractSource(),
    buildClientCanvasViewSource(),
    buildDshClientDockViewSource(),
    buildClientSlotsPluginSource()
  ].join('\n');
  return [
    'window.__ModuleLoader__.load({',
    `  id: ${JSON.stringify(DSH_BUNDLE_NAME)},`,
    '  factory(require) {',
    body,
    '  }',
    '});',
    ''
  ].join('\n');
}
