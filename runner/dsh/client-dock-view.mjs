// DSH 卡包抽卡式零缝隙主对话复刻抽屉视图组件（双击改名、滚轮历史翻阅、右上角固定与顶部拖拽调高）
export function buildDshClientDockViewSource() {
  return String.raw`
    function renderPinIcon(pinned) {
      return h("svg", {
        width: "12", height: "12", viewBox: "0 0 16 16", fill: pinned ? "currentColor" : "none", "aria-hidden": "true",
        style: { flexShrink: 0, transform: pinned ? "none" : "rotate(28deg)", transition: "transform 0.15s ease" }
      }, h("path", {
        d: "M9.8 2.2L13.8 6.2L12.4 7.6L11.2 6.8L8.6 9.4L9.2 11.8L7.8 13.2L5.3 10.7L2.4 13.6L1.8 13L4.7 10.1L2.2 7.6L3.6 6.2L6 6.8L8.6 4.2L7.8 3L9.8 2.2Z",
        stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round"
      }));
    }

    function DoneGateInputDock(props) {
      var sessionId = resolveSessionId(props);
      var t = props.t || function (k) { return zh[k] || k; };
      var snap = React.useSyncExternalStore
        ? React.useSyncExternalStore(dockStore.subscribe, dockStore.getSnapshot, dockStore.getSnapshot)
        : dockStore.getSnapshot();

      var editingState = React.useState ? React.useState(false) : [false, function () {}];
      var editingName = editingState[0];
      var setEditingName = editingState[1];

      var draftNameState = React.useState ? React.useState(snap.agentName) : [snap.agentName, function () {}];
      var draftName = draftNameState[0];
      var setDraftName = draftNameState[1];

      var draggingState = React.useState ? React.useState(false) : [false, function () {}];
      var isDragging = draggingState[0];
      var setIsDragging = draggingState[1];

      var openThinkingState = React.useState ? React.useState({}) : [{}, function () {}];
      var openThinking = openThinkingState[0];
      var setOpenThinking = openThinkingState[1];

      var scrollBoxRef = React.useRef ? React.useRef(null) : { current: null };
      var stickBottomRef = React.useRef ? React.useRef(true) : { current: true };
      var nameInputRef = React.useRef ? React.useRef(null) : { current: null };

      var items = (snap && snap.items) || [];
      var syncedMsgs = (snap && snap.messages) || [];
      var entries = extractLiveConversationEntries(props, syncedMsgs);

      var isDoneGateActive = typeof props.isDoneGateActive === "function" ? props.isDoneGateActive(sessionId) : true;
      if (!isDoneGateActive) return null;

      var topReceipt = items[0] || null;
      var isBlockingReceipt = Boolean(topReceipt && (topReceipt.kind === "question" || topReceipt.kind === "blocked"));
      var expanded = Boolean(snap.pinned || snap.hovered || isDragging || isBlockingReceipt);
      var agentName = snap.agentName || "Agent";

      var latestAgentEntry = null;
      for (var i = entries.length - 1; i >= 0; i--) {
        if (entries[i] && entries[i].role === "assistant" && (entries[i].text || (entries[i].tools && entries[i].tools.length))) {
          latestAgentEntry = entries[i];
          break;
        }
      }

      var latestAgentLine = latestAgentEntry
        ? (flattenSingleLinePreview(latestAgentEntry.text) || ("正在执行 " + latestAgentEntry.tools.join("、") + "…"))
        : (topReceipt && topReceipt.title ? flattenSingleLinePreview(topReceipt.title) : "");

      var popKey = latestAgentEntry ? (latestAgentEntry.id + ":" + latestAgentLine.length) : "idle";
      var needsMarquee = latestAgentLine.length > 40;
      var marqueeDurSec = Math.max(9, Math.min(28, Math.round(latestAgentLine.length * 0.22))) + "s";

      if (React.useEffect) {
        React.useEffect(function () {
          if (editingName && nameInputRef.current) {
            try {
              nameInputRef.current.focus();
              nameInputRef.current.select();
            } catch (err) { void err; }
          }
        }, [editingName]);

        React.useEffect(function () {
          if (!expanded || !scrollBoxRef.current) return;
          if (stickBottomRef.current) {
            scrollBoxRef.current.scrollTop = scrollBoxRef.current.scrollHeight;
          }
        }, [expanded, entries.length, latestAgentLine]);
      }

      function commitAgentRename() {
        setEditingName(false);
        var next = String(draftName || "").trim() || "Agent";
        dockStore.setAgentName(next);
        var ifr = iframeBySession.get(sessionId);
        if (ifr && ifr.contentWindow) {
          ifr.contentWindow.postMessage({ source: "donegate-host", type: "dg:agent-name-sync", agentName: next }, "*");
        }
      }

      function startAgentRename(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        setDraftName(agentName);
        setEditingName(true);
      }

      function renderAgentPrefix() {
        if (editingName) {
          return h("input", {
            ref: nameInputRef,
            type: "text",
            value: draftName,
            onClick: function (e) { e.stopPropagation(); },
            onDoubleClick: function (e) { e.stopPropagation(); },
            onChange: function (e) { setDraftName(e.target.value); },
            onBlur: commitAgentRename,
            onKeyDown: function (e) {
              e.stopPropagation();
              if (e.key === "Enter") commitAgentRename();
              else if (e.key === "Escape") setEditingName(false);
            },
            style: {
              width: Math.max(54, Math.min(132, (String(draftName || "").length + 2) * 13)) + "px",
              height: "22px",
              padding: "0 6px",
              borderRadius: "6px",
              border: "0.5px solid var(--dsw-alias-border-l3, rgba(255,255,255,0.32))",
              background: "var(--dsw-alias-bg-base, #151517)",
              color: "var(--dsw-alias-label-primary, #f9fafb)",
              fontSize: "12.5px",
              fontWeight: 600,
              outline: "none",
              flexShrink: 0
            }
          });
        }
        return h("span", {
          title: t("dock.renameTip"),
          onDoubleClick: startAgentRename,
          style: {
            fontWeight: 600,
            color: "var(--dsw-alias-label-primary, #f9fafb)",
            cursor: "text",
            userSelect: "none",
            flexShrink: 0
          }
        }, agentName + "：");
      }

      function onStartResizeHeight(e) {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var startY = e.clientY;
        var startH = snap.height || DEFAULT_EXPANDED_PX;
        setIsDragging(true);
        function onMove(ev) {
          var delta = startY - ev.clientY;
          dockStore.setHeight(startH + delta);
        }
        function onUp() {
          setIsDragging(false);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        }
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      }

      function flyToNode(nodeId) {
        if (typeof props.activateDoneGateView === "function") props.activateDoneGateView(sessionId);
        var ifr = iframeBySession.get(sessionId);
        if (ifr && ifr.contentWindow) {
          ifr.contentWindow.postMessage({ source: "donegate-host", type: "dg:focus-node", nodeId: nodeId }, "*");
        }
      }

      var visibleHeight = expanded ? clampHeight(snap.height) : COLLAPSED_LIP_PX;
      var totalCardHeight = visibleHeight + TUCK_OVERLAP_PX;
      var strokeColor = isBlockingReceipt
        ? "var(--dsw-alias-state-warn-primary, rgba(245, 158, 11, 0.55))"
        : "var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.2))";

      return h("div", {
        "data-donegate-dock-wrap": "",
        onMouseEnter: function (e) {
          if (e && e.pointerType === "touch") return;
          dockStore.setHovered(true);
        },
        onMouseLeave: function () {
          if (!editingName && !isDragging) dockStore.setHovered(false);
        },
        style: {
          boxSizing: "border-box",
          position: "relative",
          zIndex: 1,
          margin: "0 auto calc(0px - var(--dsh-composer-stack-gap, 6px) - " + TUCK_OVERLAP_PX + "px)",
          width: "calc(100% - 2 * var(--dsh-composer-side-clearance, 16px))",
          maxWidth: "var(--dsh-composer-card-max-width, 760px)",
          fontFamily: "var(--dsw-font-family, inherit)"
        }
      }, h("div", {
        "data-donegate-dock-card": "",
        "data-expanded": expanded ? "1" : "0",
        style: {
          boxSizing: "border-box",
          position: "relative",
          width: "100%",
          height: totalCardHeight + "px",
          paddingBottom: TUCK_OVERLAP_PX + "px",
          borderRadius: "var(--dsw-radius-xl, 20px) var(--dsw-radius-xl, 20px) 0 0",
          borderTop: "0.5px solid " + strokeColor,
          borderLeft: "0.5px solid " + strokeColor,
          borderRight: "0.5px solid " + strokeColor,
          borderBottom: "none",
          background: "color-mix(in srgb, var(--dsw-specific-input-major, #2c2c2e) 72%, var(--dsw-alias-bg-base, #151517) 28%)",
          backdropFilter: "var(--dsw-menu-backdrop-filter, blur(36px) saturate(145%))",
          WebkitBackdropFilter: "var(--dsw-menu-backdrop-filter, blur(36px) saturate(145%))",
          boxShadow: expanded ? "0 -8px 28px rgba(0, 0, 0, 0.14)" : "0 -2px 10px rgba(0, 0, 0, 0.05)",
          overflow: "hidden",
          transition: isDragging ? "none" : "height 0.2s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.2s ease",
          display: "flex",
          flexDirection: "column"
        }
      },
        expanded ? h(React.Fragment || "div", null,
          /* 顶部拖拽调高条（拉到多高下次展开就是多高） */
          h("div", {
            "data-donegate-resize-bar": "",
            title: t("dock.resizeTip"),
            onPointerDown: onStartResizeHeight,
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "10px",
              cursor: "ns-resize",
              zIndex: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              touchAction: "none"
            }
          }, h("span", {
            "data-donegate-resize-pill": "",
            style: {
              width: "32px",
              height: "3px",
              borderRadius: "999px",
              background: "var(--dsw-alias-label-tertiary, #81858c)",
              opacity: isDragging ? 0.82 : 0.28,
              transition: "opacity 0.15s ease, width 0.15s ease"
            }
          })),

          /* 右上角悬浮固定开关（无多余标题栏、无切回按钮） */
          h("button", {
            type: "button",
            "data-donegate-pin-btn": "",
            onClick: function (e) { e.stopPropagation(); dockStore.togglePinned(); },
            style: {
              position: "absolute",
              top: "8px",
              right: "12px",
              zIndex: 9,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              height: "24px",
              padding: "0 9px",
              borderRadius: "var(--dsw-radius-sm, 8px)",
              border: "0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22))",
              background: snap.pinned
                ? "var(--dsw-alias-brand-primary, #f9fafb)"
                : "var(--dsw-specific-input-major, rgba(44, 44, 46, 0.86))",
              color: snap.pinned
                ? "var(--dsw-alias-bg-base, #151517)"
                : "var(--dsw-alias-label-secondary, #cfd3d6)",
              fontSize: "11.5px",
              fontWeight: 500,
              cursor: "pointer",
              backdropFilter: "blur(12px)"
            }
          }, renderPinIcon(snap.pinned), snap.pinned ? t("dock.pinned") : t("dock.pin")),

          /* 主对话窗口完整复刻区（支持鼠标滚轮上下翻阅双方完整历史发言） */
          h("div", {
            ref: scrollBoxRef,
            "data-donegate-chat-scroll": "",
            onWheel: function (e) { e.stopPropagation(); },
            onScroll: function (e) {
              var el = e.currentTarget;
              if (!el) return;
              stickBottomRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 36;
            },
            style: {
              flex: "1 1 0%",
              minHeight: 0,
              overflowY: "auto",
              overscrollBehavior: "contain",
              padding: "16px 16px 12px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              color: "var(--dsw-alias-label-primary, #f9fafb)",
              fontSize: "var(--dsh-content-font-size, 13.5px)",
              lineHeight: "22px"
            }
          },
            entries.length ? entries.map(function (entry) {
              if (entry.role === "user") {
                return h("div", {
                  key: entry.id,
                  style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }
                },
                  entry.quotes && entry.quotes.length ? h("div", {
                    style: { display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "4px", maxWidth: "82%" }
                  }, entry.quotes.map(function (q, qIdx) {
                    return h("span", {
                      key: "q-" + qIdx,
                      style: {
                        padding: "1px 7px",
                        borderRadius: "6px",
                        fontSize: "11.5px",
                        background: "var(--dsw-alias-interactive-bg-hover, rgba(128, 128, 128, 0.14))",
                        color: "var(--dsw-alias-label-secondary, #cfd3d6)"
                      }
                    }, q);
                  })) : null,
                  entry.text ? h("div", {
                    style: {
                      maxWidth: "80%",
                      padding: "8px 14px",
                      borderRadius: "18px",
                      background: "var(--dsw-specific-bubble, rgba(128, 128, 128, 0.16))",
                      color: "var(--dsw-alias-label-primary, #f9fafb)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word"
                    }
                  }, entry.text) : null
                );
              }

              var thinkOpen = Boolean(openThinking && openThinking[entry.id]);
              return h("div", {
                key: entry.id,
                style: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px", width: "100%", paddingRight: "52px", boxSizing: "border-box" }
              },
                h("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
                  renderAgentPrefix(),
                  entry.reasoning ? h("button", {
                    type: "button",
                    onClick: function () {
                      var nextMap = Object.assign({}, openThinking);
                      nextMap[entry.id] = !thinkOpen;
                      setOpenThinking(nextMap);
                    },
                    style: {
                      height: "20px", padding: "0 7px", borderRadius: "6px",
                      border: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.16))",
                      background: "transparent", color: "var(--dsw-alias-label-tertiary, #81858c)",
                      fontSize: "11.5px", cursor: "pointer"
                    }
                  }, t("dock.thinking") + (thinkOpen ? " ▴" : " ▾")) : null,
                  entry.tools && entry.tools.length ? entry.tools.slice(0, 4).map(function (tl, tIdx) {
                    return h("span", {
                      key: "tl-" + tIdx,
                      style: {
                        padding: "0 6px", height: "19px", lineHeight: "19px", borderRadius: "5px",
                        background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))",
                        color: "var(--dsw-alias-label-tertiary, #81858c)",
                        fontFamily: "ui-monospace, monospace", fontSize: "11px"
                      }
                    }, tl);
                  }) : null
                ),
                thinkOpen && entry.reasoning ? h("div", {
                  style: {
                    padding: "6px 10px",
                    borderLeft: "2px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))",
                    color: "var(--dsw-alias-label-tertiary, #81858c)",
                    fontSize: "12.5px",
                    lineHeight: "19px",
                    whiteSpace: "pre-wrap"
                  }
                }, entry.reasoning) : null,
                entry.text ? h("div", {
                  style: { width: "100%", color: "var(--dsw-alias-label-primary, #f9fafb)" }
                }, renderFormattedChatBlocks(entry.text)) : null
              );
            }) : h("div", {
              style: { color: "var(--dsw-alias-label-tertiary, #81858c)", fontSize: "12.5px", padding: "6px 0" }
            }, t("dock.empty")),

            topReceipt && topReceipt.targetNodeId ? h("div", {
              style: {
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px",
                padding: "6px 10px", borderRadius: "10px",
                background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))",
                fontSize: "12px", color: "var(--dsw-alias-label-secondary, #cfd3d6)"
              }
            },
              h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, String(topReceipt.title || "")),
              h("button", {
                type: "button",
                onClick: function () { flyToNode(topReceipt.targetNodeId); },
                style: {
                  height: "22px", padding: "0 8px", borderRadius: "6px",
                  border: "0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))",
                  background: "transparent", color: "var(--dsw-alias-label-primary, #f9fafb)", cursor: "pointer", fontSize: "11.5px", flexShrink: 0
                }
              }, t("dock.fly"))
            ) : null
          )
        ) : (
          /* 收起态卡口（34px）：仅显示可双击改名的「Agent：」+ 最新一条滚动真实消息 */
          h("div", {
            onClick: function () { if (!editingName) dockStore.setHovered(true); },
            style: {
              height: COLLAPSED_LIP_PX + "px",
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              fontSize: "13px",
              lineHeight: "20px",
              cursor: "pointer",
              overflow: "hidden"
            }
          },
            renderAgentPrefix(),
            h("div", {
              key: popKey,
              "data-donegate-msg-pop": "",
              style: {
                flex: "1 1 0%",
                minWidth: 0,
                overflow: "hidden",
                whiteSpace: "nowrap",
                color: latestAgentLine
                  ? "var(--dsw-alias-label-secondary, #cfd3d6)"
                  : "var(--dsw-alias-label-tertiary, #81858c)"
              }
            }, h("span", {
              "data-donegate-marquee": needsMarquee ? "1" : "0",
              style: needsMarquee ? { "--dg-marquee-dur": marqueeDurSec } : undefined
            }, latestAgentLine || t("dock.waiting")))
          )
        )
      ));
    }

`;
}
