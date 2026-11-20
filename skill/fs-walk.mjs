// 递归遍历文件的**唯一实现**（2026-11-19 统一；此前 4 处通用 walk 各写一份，另有 3 处同名但语义不同，
// 见 08 §56 与 skill/11）。为什么必须统一：同名 walk 的 4 份副本「跳过哪些目录」各不相同，
// 而「拿路径/目录名代理内容」正是 09 §五 坑 5 那个让 W8 整节读数作废的形状（adr/013）。
//
// 语义固定为：深度优先、**保持 readdirSync 的原始顺序**（不排序，否则「第一个命中」会变），
// 返回 { files, unreadable }——读不出的目录**不再抛异常**，而是进 unreadable 由调用方上报。
// 旧实现在 check-reviewpack / pilot-reviewpack-audit 里没有 try/catch：遇到读不出的目录会把整条
// 检查崩掉，而 02-规格 §八 要求这种情况是「无法判断（3）」，不是崩。
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_SKIP = ['node_modules', '.git'];

/**
 * @param {string} dir 起点
 * @param {{ skipDirs?: string[], maxDepth?: number, onUnreadable?: 'skip' | 'throw' }} [opts]
 * @returns {{ files: string[], unreadable: string[] }}
 */
export const walk = (dir, opts = {}) => {
  const skipDirs = new Set(opts.skipDirs || DEFAULT_SKIP);
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : Infinity;
  const files = [];
  const unreadable = [];
  const visit = (d, depth) => {
    if (depth > maxDepth) return;
    let ents = [];
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      unreadable.push(d);
      if (opts.onUnreadable === 'throw') throw new Error('目录读不出来：' + d);
      return;
    }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name)) visit(p, depth + 1);
      } else {
        files.push(p);
      }
    }
  };
  visit(dir, 0);
  return { files, unreadable };
};

/**
 * 只取指定扩展名的文件（递归）。两个脚本原先各写一份 walkMd，被 check-symbols 的「同名不同体」判据抓出来。
 * @param {string} dir
 * @param {string[]} exts 例如 ['.md']
 * @param {{ skipDirs?: string[] }} [opts]
 * @returns {string[]}
 */
export const walkByExt = (dir, exts, opts = {}) => walk(dir, opts).files.filter((f) => exts.some((e) => f.endsWith(e)));
