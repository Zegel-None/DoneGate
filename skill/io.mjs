// 读盘与路径格式化的**唯一实现**（统一全仓 readText / readMaybe / readJsonStrict 口径，不放业务判断）。
import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';

/**
 * 读文本，**不抛**。三种结果分开报：
 *   { ok:true,  text,  error:null }
 *   { ok:false, text:null, error:'missing' }   文件不存在
 *   { ok:false, text:null, error:'unreadable' } 其他读失败（权限/是目录/…）
 * 分 `missing` 与 `unreadable` 是因为 02-规格 §八 里「材料缺了(3)」与「确定坏了(2)」处置相反。
 */
export const readText = (p) => {
  try {
    return { ok: true, text: readFileSync(p, 'utf8'), error: null };
  } catch (e) {
    const code = e && e.code;
    return { ok: false, text: null, error: code === 'ENOENT' ? 'missing' : 'unreadable' };
  }
};

/**
 * 「读不出就是 null」——这是**刻意保留的旧策略**，不是漏掉的错误处理。
 * 理由：各评分器/审计器把「这个文件不在」当成「这条不适用」来分支（例如没写 GATE0.md 就不评 0.1），
 * 在这里抛或返回三态会逼所有调用点改判断。要区分三态的新代码请用 `readText` / `readJsonStrict`。
 */
export const readMaybe = (p) => readText(p).text;

/** 读 JSON，读不出或解析失败都返回 null（多数脚本的旧语义）。 */
export const readJson = (p) => {
  const r = readText(p);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
};

/**
 * 读 JSON 的三态版：`{ ok, value, error:'missing' | 'unreadable' | 'parse' }`。
 * 只有需要区分「材料缺了」与「材料是坏的」的调用方才用它（例：pilot-score 的 `bad` 标记）。
 */
export const readJsonStrict = (p) => {
  const r = readText(p);
  if (!r.ok) return { ok: false, value: null, error: r.error };
  try {
    return { ok: true, value: JSON.parse(r.text), error: null };
  } catch {
    return { ok: false, value: null, error: 'parse' };
  }
};

/**
 * 百分比。**只有有限非零分母才出数字**——`0` / `undefined` / `NaN` 一律 '-'。
 * 旧的三份实现里有一份写 `d === 0 ? '-' : …`，遇到 `undefined` 会输出 `NaN%`；
 * 统一到这里之后那个输出没有了（这是本轮唯一的可见行为变化，见 08 §56）。
 */
export const pct = (n, d) => (!Number.isFinite(d) || d === 0 ? '-' : (Math.round((n / d) * 1000) / 10) + '%');

/**
 * 相对路径统一成 `/` 分隔（跨平台）。旧实现在 5 处各写一份
 * `relative(ROOT, p).split(sep).join('/')`，这里把 root 变成参数。
 */
export const relTo = (root, p) => relative(root, p).split(sep).join('/');

/** 字段是不是「非空字符串」——判据卡里反复出现的同一条检查，两处本地各写一份，收到这里。 */
export const hasText = (obj, key) => !!obj && typeof obj[key] === 'string' && obj[key].trim().length > 0;