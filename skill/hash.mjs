// 项目里**唯一一处** SHA-256 口径（2026-11-19 统一；依据 skill/10 的 G-09 精确化 + 08 §55.2 的读数）。
//
// 为什么要有它：此前 11 个脚本各写一份 `sha` / `sha256` 助手，实测出现 **4 类变体**——
// 全长 hex、截断 12 位（install-skills 拿它比较两份文件）、截断 16 位（pilot-gen-judge 造夹具）、
// 带 `?? ''` 空值守卫（run-criterion，其余传 undefined 会抛）。改一次哈希规则要动 11 处，
// 漏一处就出现「同一套东西两套哈希」——这正是 G-09 欠定暴露出来的那类问题。
//
// 分两层：**本文件是唯一的实现**；各脚本只在顶部留一行「本文件用什么口径」的 alias（截断长度属于调用方策略）。
import { createHash } from 'node:crypto';

/** 原始哈希：接受 string / Buffer / TypedArray；undefined/null 当空串（不再各写一份守卫）。 */
export const sha256 = (value) => createHash('sha256').update(value ?? '').digest('hex');

/** 只用于展示或短标识的截断哈希（比较两份文件是否一致时也够用：48 bit 碰撞概率可忽略）。 */
export const sha256Short = (value, len = 12) => sha256(value).slice(0, len);

/** 键名**递归**按字典序排序（数组保序）。 */
export const sortKeysDeep = (v) => {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeysDeep(v[k])]));
  return v;
};

/**
 * `frozenHash` 的归一化（G-09，2026-11-19 精确化）：
 * obligation 去掉 `frozenHash`（哈希自身）、`teeth`（实验记录）、`signedBy`（签名元数据）
 * → 键名递归排序 → `JSON.stringify` 紧凑形式 → UTF-8 → SHA-256 小写十六进制。
 *
 * 为什么排除 `signedBy`：§2.4 说的是「判据**内容**的哈希」，签名不属于内容；不排除会出现
 * 「换签字人就动哈希」的抖动（W24b 里 E2 与 E1/E3 就是因为这一点分家的，见 08 §55.2）。
 * 为什么**不**排除 `scopeAck`：G-10 定的是「先取裁方确认 → 算哈希 → 签字」，确认属于内容。
 */
export const frozenHashOf = (obligation) => {
  const { frozenHash, teeth, signedBy, ...rest } = obligation || {};
  return sha256(JSON.stringify(sortKeysDeep(rest)));
};

/**
 * `materialFingerprint` 的唯一归一化口径（D01 · 消除卡片列表与夹具单值的双口径）：
 * 接收 `[{ path, sha256 }]` 或 `{ [path]: sha256 }`，统一路径为 `/`、剥离可选 `sha256:` 前缀并转小写、
 * 按 `path` 字典序排序后 `JSON.stringify` 紧凑序列化，返回 64 位裸小写 hex（对齐协议 v1.1）。
 */
export const materialFingerprintOf = (materials) => {
  const entries = Array.isArray(materials)
    ? materials.map((m) => ({
        path: String((m && m.path) || '').replace(/\\/g, '/'),
        sha256: String((m && (m.sha256 || m.hash)) || '').replace(/^sha256:/i, '').toLowerCase()
      }))
    : Object.entries(materials || {}).map(([p, h]) => ({
        path: String(p).replace(/\\/g, '/'),
        sha256: String(h || '').replace(/^sha256:/i, '').toLowerCase()
      }));
  entries.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return sha256(JSON.stringify(entries));
};
