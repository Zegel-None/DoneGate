// DSH 主对话快照 (ChatSnapshot.legacy / partial) 实时消息提取、引用标签清洗与 uiOwner 切片路由提示子模块
export function buildDshClientChatExtractSource() {
  return String.raw`
    function parseUserQuoteTags(rawText) {
      var quotes = [];
      var sliceHints = [];
      var cleaned = String(rawText || "").replace(/\[DG-TARGET\s+([^\]]+)\]/g, function (_m, body) {
        var lblM = String(body).match(/(?:label|name)=([^|\]]+)/);
        var kindM = String(body).match(/kind=([^|\]]+)/);
        var uiM = String(body).match(/uiOwner=([^|\]]+)/);
        var cmdM = String(body).match(/sliceCmd=([^|\]]+)/);
        var label = lblM ? lblM[1].trim().replace(/^"|"$/g, "") : "引用目标";
        var kind = kindM ? kindM[1].trim() : "card";
        var uiOwner = uiM ? uiM[1].trim().replace(/^"|"$/g, "") : "";
        var sliceCmd = cmdM ? cmdM[1].trim().replace(/^"|"$/g, "") : "";
        var prefix = (kind === "wire" || kind === "link") ? "[连线]" : (kind === "ui" ? "[UI]" : ((kind === "button" || kind === "control") ? "[按钮]" : "[节点]"));
        quotes.push(prefix + " " + label + (uiOwner && uiOwner !== "-" ? " @" + uiOwner.split("/").pop() : ""));
        if (sliceCmd && sliceCmd !== "-") {
          sliceHints.push(sliceCmd);
        } else if (uiOwner && uiOwner.indexOf("runner/atlas/") === 0) {
          sliceHints.push("node runner/donegate.mjs slice atlas-workbench --focus " + uiOwner);
        } else if (uiOwner && uiOwner.indexOf("runner/dsh/") === 0) {
          sliceHints.push("node runner/donegate.mjs slice dsh-orchestrator --focus " + uiOwner);
        }
        return "";
      }).trim();
      var routingHint = sliceHints.length
        ? ("收到含 DG-TARGET 的消息时，若改界面交互/样式优先直接运行胶囊给出的 sliceCmd（" + sliceHints.join(" ; ") + "），零手动 grep 直达目标 UI 模块")
        : "";
      return { quotes: quotes, sliceHints: sliceHints, routingHint: routingHint, text: cleaned };
    }

    function extractContentBlocksText(blocks) {
      if (typeof blocks === "string") return blocks.trim();
      if (!Array.isArray(blocks)) return "";
      var parts = [];
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        if (!b) continue;
        if (typeof b === "string") parts.push(b);
        else if ((b.type === "text" || b.kind === "text") && typeof b.text === "string") parts.push(b.text);
        else if (typeof b.content === "string") parts.push(b.content);
      }
      return parts.join("\n").trim();
    }

    function parseAssistantBlocks(blocks) {
      var texts = [];
      var reasonings = [];
      var tools = [];
      if (Array.isArray(blocks)) {
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          if (!b) continue;
          if ((b.kind === "text" || b.type === "text") && b.text) texts.push(String(b.text));
          else if ((b.kind === "reasoning" || b.type === "reasoning") && b.text) reasonings.push(String(b.text));
          else if (b.kind === "tool-call" || b.type === "tool-call") tools.push(String(b.name || "tool"));
        }
      }
      return {
        text: texts.join("\n\n").trim(),
        reasoning: reasonings.join("\n").trim(),
        tools: tools
      };
    }

    function extractLiveConversationEntries(props, syncedMsgs) {
      var chatSnap = null;
      if (props && typeof props.useConversation === "function") {
        try {
          chatSnap = props.useConversation(function (c) {
            return c && c.views && typeof c.views.get === "function" ? c.views.get("chat") : null;
          });
        } catch (err) { void err; }
      }

      var list = [];
      var legacyNodes = chatSnap && chatSnap.legacy && Array.isArray(chatSnap.legacy.nodes) ? chatSnap.legacy.nodes : null;

      if (legacyNodes && legacyNodes.length > 0) {
        for (var i = 0; i < legacyNodes.length; i++) {
          var nd = legacyNodes[i];
          if (!nd) continue;
          if (nd.kind === "user" || nd.kind === "steering") {
            var rawU = extractContentBlocksText(nd.content);
            var parsedU = parseUserQuoteTags(rawU);
            var refLabels = Array.isArray(nd.referenceLabels) ? nd.referenceLabels : [];
            var allQuotes = parsedU.quotes.concat(refLabels);
            if (parsedU.text || allQuotes.length) {
              list.push({
                id: String(nd.messageId || ("u-" + nd.seq + "-" + i)),
                role: "user",
                text: parsedU.text,
                quotes: allQuotes,
                sliceHints: parsedU.sliceHints,
                routingHint: parsedU.routingHint
              });
            }
          } else if (nd.kind === "assistant") {
            var parsedA = parseAssistantBlocks(nd.blocks);
            if (parsedA.text || parsedA.tools.length || parsedA.reasoning) {
              var prev = list.length ? list[list.length - 1] : null;
              if (prev && prev.role === "assistant" && prev.turn !== undefined && nd.turn !== undefined && prev.turn === nd.turn && !prev.streaming) {
                if (parsedA.reasoning) prev.reasoning = (prev.reasoning ? prev.reasoning + "\n" : "") + parsedA.reasoning;
                if (parsedA.tools.length) prev.tools = prev.tools.concat(parsedA.tools);
                if (parsedA.text) prev.text = (prev.text ? prev.text + "\n\n" : "") + parsedA.text;
                prev.id = String(nd.messageId || ("a-" + nd.seq + "-" + i));
              } else {
                list.push({
                  id: String(nd.messageId || ("a-" + nd.seq + "-" + i)),
                  role: "assistant",
                  turn: nd.turn,
                  text: parsedA.text,
                  reasoning: parsedA.reasoning,
                  tools: parsedA.tools,
                  interrupted: Boolean(nd.interrupted)
                });
              }
            }
          } else if (nd.kind === "turn-error" && nd.message) {
            list.push({
              id: "err-" + nd.seq + "-" + i,
              role: "assistant",
              text: "⚠ " + String(nd.message),
              tools: [],
              reasoning: ""
            });
          }
        }
      } else if (chatSnap && Array.isArray(chatSnap.order) && chatSnap.nodes && typeof chatSnap.nodes.get === "function") {
        for (var kIdx = 0; kIdx < chatSnap.order.length; kIdx++) {
          var vNode = chatSnap.nodes.get(chatSnap.order[kIdx]);
          var d = vNode && vNode.data;
          if (!d) continue;
          if (d.kind === "user" || d.kind === "steering") {
            var uTxt = extractContentBlocksText(d.content);
            var pu = parseUserQuoteTags(uTxt);
            if (pu.text || pu.quotes.length) list.push({ id: String(vNode.key || kIdx), role: "user", text: pu.text, quotes: pu.quotes, sliceHints: pu.sliceHints, routingHint: pu.routingHint });
          } else if (d.kind === "assistant" || Array.isArray(d.blocks)) {
            var pa = parseAssistantBlocks(d.blocks);
            if (pa.text || pa.tools.length) list.push({ id: String(vNode.key || kIdx), role: "assistant", text: pa.text, reasoning: pa.reasoning, tools: pa.tools });
          }
        }
      }

      var partial = chatSnap && chatSnap.legacy ? chatSnap.legacy.partial : null;
      if (partial && Array.isArray(partial.blocks)) {
        var pp = parseAssistantBlocks(partial.blocks);
        if (pp.text || pp.reasoning || pp.tools.length) {
          list.push({
            id: "streaming-partial",
            role: "assistant",
            text: pp.text,
            reasoning: pp.reasoning,
            tools: pp.tools,
            streaming: true
          });
        }
      }

      if (!list.length && Array.isArray(syncedMsgs) && syncedMsgs.length) {
        for (var sIdx = 0; sIdx < syncedMsgs.length; sIdx++) {
          var sm = syncedMsgs[sIdx];
          if (sm && sm.text && sm.id !== "welcome-1") {
            list.push({ id: String(sm.id || ("sync-" + sIdx)), role: sm.role || "assistant", text: String(sm.text), tools: [], quotes: [] });
          }
        }
      }
      return list;
    }

    function flattenSingleLinePreview(raw) {
      return String(raw || "")
        .replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, " [代码片段] ")
        .replace(/[#>*_\x60~]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function renderFormattedChatBlocks(rawText) {
      var text = String(rawText || "");
      if (!text) return null;
      var segments = text.split(/(\x60\x60\x60[\s\S]*?\x60\x60\x60)/g);
      var out = [];
      for (var i = 0; i < segments.length; i++) {
        var seg = segments[i];
        if (!seg) continue;
        if (seg.indexOf("\x60\x60\x60") === 0 && seg.length >= 6) {
          var body = seg.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/, "");
          out.push(h("pre", {
            key: "code-" + i,
            style: {
              margin: "6px 0",
              padding: "8px 11px",
              borderRadius: "var(--dsw-radius-md, 12px)",
              background: "var(--dsw-alias-bg-base, rgba(0, 0, 0, 0.28))",
              border: "0.5px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.16))",
              overflowX: "auto",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: "12px",
              lineHeight: "18px",
              whiteSpace: "pre"
            }
          }, body.trim()));
        } else {
          var paras = seg.split(/\n{2,}/);
          for (var pIdx = 0; pIdx < paras.length; pIdx++) {
            var p = paras[pIdx].trim();
            if (!p) continue;
            out.push(h("div", {
              key: "p-" + i + "-" + pIdx,
              style: { whiteSpace: "pre-wrap", wordBreak: "break-word", margin: pIdx > 0 ? "6px 0 0" : "0" }
            }, p));
          }
        }
      }
      return out;
    }

`;
}
