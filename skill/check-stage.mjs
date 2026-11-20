// 门 2 段位到期硬门（D05 · B2 裁决）：按事件判段（T1a/T1b/T1c/T1完整），按首轮日期兜底期限。
// 用法：
//   node skill/check-stage.mjs [--root <项目根>] [--today YYYY-MM-DD]
// 退出码（§八 四值）：
//   0 = 未过当前段位期限
//   1 = 已过当前段位期限（判定为否）
//   2 = 确定性事故（契约 JSON 损坏）
//   3 = 无法判断（参数/根目录不可读、无 decisions/、目录空、或文件名解析不出首轮日期）
//
// 诚实边界（按 adr/007 降一档采信）：
//   1. 只判「已声明有牙且已签」（signedBy 非空且 teeth.result === 'killed'），不核证据三件套是否真实（门 4 管）；
//   2. 「契约数」只数 contracts/*/contract.json 目录，不判切得对不对；
//   3. 首轮日期取 decisions/ 最早一条的文件名前 10 字符，不核 git 提交时间。

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from './io.mjs';

const STAGE_RULES = {
  T1a: { months: 1, eff: '3/9' },
  T1b: { months: 2, eff: '5/9' },
  T1c: { months: 3, eff: '8/9' },
  'T1完整': { months: 4, eff: '9/9' }
};

function parseIsoDateStr(s) {
  const m = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d, iso: m[0] };
}

function addMonthsIsoStr(parsed, months) {
  const totalMonths = (parsed.y * 12 + (parsed.mo - 1)) + months;
  const ty = Math.floor(totalMonths / 12);
  const tm = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(parsed.d, lastDay);
  return String(ty).padStart(4, '0') + '-' + String(tm).padStart(2, '0') + '-' + String(td).padStart(2, '0');
}

function diffDaysIsoStr(fromIso, toIso) {
  const a = parseIsoDateStr(fromIso), b = parseIsoDateStr(toIso);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.mo - 1, b.d) - Date.UTC(a.y, a.mo - 1, a.d)) / 86400000);
}

function localTodayIsoStr() {
  const now = new Date();
  return String(now.getFullYear()).padStart(4, '0') + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
}

export function evalStageGate(projectRoot, todayOverride) {
  let rootOk = false;
  try { rootOk = !!projectRoot && statSync(projectRoot).isDirectory(); } catch { rootOk = false; }
  if (!rootOk) return { exitCode: 3, line: 'RESULT: 无法判断 项目根目录不存在或不可读：' + projectRoot };

  const todayStr = todayOverride || localTodayIsoStr();
  if (!parseIsoDateStr(todayStr)) {
    return { exitCode: 2, line: 'RESULT: 事故 --today 日期格式非法：' + todayStr };
  }

  const decDir = join(projectRoot, 'decisions');
  let decFiles = [];
  try {
    if (!existsSync(decDir) || !statSync(decDir).isDirectory()) {
      return { exitCode: 3, line: 'RESULT: 无法判断 没有 decisions/ 目录，无法确定首轮日期' };
    }
    decFiles = readdirSync(decDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return { exitCode: 3, line: 'RESULT: 无法判断 decisions/ 目录不可读' };
  }
  if (decFiles.length === 0) {
    return { exitCode: 3, line: 'RESULT: 无法判断 decisions/ 目录为空，无法确定首轮日期' };
  }

  const decDates = decFiles.map((n) => parseIsoDateStr(n.slice(0, 10))).filter(Boolean).sort((a, b) => a.iso.localeCompare(b.iso));
  if (decDates.length === 0) {
    return { exitCode: 3, line: 'RESULT: 无法判断 decisions/ 文件名前 10 字符均不是合法 YYYY-MM-DD' };
  }
  const firstDate = decDates[0];

  const cDir = join(projectRoot, 'contracts');
  let contractCount = 0;
  let hasCleared = false;
  if (existsSync(cDir)) {
    let entries = [];
    try { entries = readdirSync(cDir, { withFileTypes: true }); }
    catch { return { exitCode: 3, line: 'RESULT: 无法判断 contracts/ 目录不可读' }; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const cPath = join(cDir, e.name, 'contract.json');
      if (!existsSync(cPath)) continue;
      const res = readJsonStrict(cPath);
      if (!res.ok) {
        if (res.error === 'parse') return { exitCode: 2, line: 'RESULT: 事故 契约 JSON 损坏：' + cPath };
        return { exitCode: 3, line: 'RESULT: 无法判断 契约读不出：' + cPath };
      }
      const c = res.value;
      if (c && c.retired) continue;
      contractCount++;
      const reqObs = Array.isArray(c && c.obligations) ? c.obligations.filter((o) => o && o.required === true) : [];
      if (reqObs.length > 0 && reqObs.every((o) => typeof o.signedBy === 'string' && o.signedBy.trim() !== '' && o.teeth && o.teeth.result === 'killed')) {
        hasCleared = true;
      }
    }
  }

  const stage = contractCount >= 8 ? 'T1完整' : contractCount >= 4 ? 'T1c' : hasCleared ? 'T1b' : 'T1a';
  const rule = STAGE_RULES[stage];
  const deadlineStr = addMonthsIsoStr(firstDate, rule.months);
  const daysLeft = diffDaysIsoStr(todayStr, deadlineStr);

  if (todayStr > deadlineStr) {
    return {
      exitCode: 1, stage, eff: rule.eff, deadline: deadlineStr, firstDate: firstDate.iso, contractCount, hasCleared, daysLeft,
      line: `RESULT: FAIL 已过 ${stage} 期限（生效 ${rule.eff}，期限 ${deadlineStr}，首轮 ${firstDate.iso}）`
    };
  }
  return {
    exitCode: 0, stage, eff: rule.eff, deadline: deadlineStr, firstDate: firstDate.iso, contractCount, hasCleared, daysLeft,
    line: `RESULT: PASS stage=${stage} 生效 ${rule.eff} 期限 ${deadlineStr}（剩余 ${daysLeft} 天）`
  };
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const argv = process.argv.slice(2);
  const rootArgIdx = argv.indexOf('--root');
  const todayArgIdx = argv.indexOf('--today');
  const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const targetRoot = rootArgIdx >= 0 ? (argv[rootArgIdx + 1] ? resolve(argv[rootArgIdx + 1]) : '') : defaultRoot;
  const todayArg = todayArgIdx >= 0 ? (argv[todayArgIdx + 1] || '') : null;
  const out = evalStageGate(targetRoot, todayArg);
  console.log(out.line);
  process.exit(out.exitCode);
}
