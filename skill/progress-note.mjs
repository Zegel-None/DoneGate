#!/usr/bin/env node
// 进度卡片开放扩展入口：供用户自己的 AI Agent 按模板补充阶段性报喜或报忧
// 防撒谎规则（由本脚本 + check-escapes.mjs 联合门禁把关）：
//   1. 绝不改变机械总进度百分比（INV-01）。
//   2. --kind good（报喜）**严禁空口白话**，必须传 --verify-cmd "<实跑命令>"（现场跑出 exit 0）
//      或 --evidence "<项目内非空证据文件>"（计算 SHA-256 指纹锁死）。
//   3. 禁止在 title/detail 中写假进度条（██░）、百分比、或「全部通关/全部完成」等越权词（违者退 2）。
//   4. 每条记录自动加 noteHash 封印，绕过本脚本直接手改 .donegate/notes.jsonl 会被核查拦下。
//
// 用法：
//   node skill/progress-note.mjs --kind good --stage 2 --title "完成真机冷启动验证" --verify-cmd "node scripts/bench.mjs" --root .
//   node skill/progress-note.mjs --kind good --stage 2 --title "补充机型测试报告" --evidence "reports/android.log" --root .
//   node skill/progress-note.mjs --kind worry --stage 3 --title "3G 弱网登录超时" --detail "平均耗时 2.8s，待下轮优化" --root .
//   node skill/progress-note.mjs --verify-all [--rerun] [--root .]
//   node skill/progress-note.mjs --clear [--stage 1|2|3|4] [--root .]
//
// 退出码：0 成功；1 校验失败/验证命令没过/缺证据；2 越权伪造或篡改事故
import { resolve } from 'node:path';
import { appendProgressNote, clearCustomNotes, renderProgressBlock, verifyProjectNotes } from '../runner/core/index.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (k) => argv.includes(k);

if (has('--help') || has('-h') || argv.length === 0) {
  console.log([
    'DoneGate 进度卡片开放入口 · 模板与防撒谎门禁',
    '',
    '模板 1 · 报喜（必须附 --verify-cmd 或 --evidence，空口报喜直接退 1）：',
    '  node skill/progress-note.mjs --kind good --stage 2 --title "完成某项实测" --verify-cmd "node test.mjs" --root .',
    '  node skill/progress-note.mjs --kind good --stage 2 --title "完成某项实测" --evidence "reports/out.log" --root .',
    '',
    '模板 2 · 报忧 / 告警（如实指出隐患，不要求 pass 证据）：',
    '  node skill/progress-note.mjs --kind worry --stage 3 --title "弱网耗时偏高" --detail "实测 2.8s" --root .',
    '  node skill/progress-note.mjs --kind alert --stage 3 --title "发现敏感配置风险" --detail "见 config.js" --root .',
    '',
    '门禁核验：',
    '  node skill/progress-note.mjs --verify-all [--rerun] [--root .]   # 核验 .donegate/notes.jsonl 封印与证据真伪',
    '  node skill/progress-note.mjs --clear [--stage 1|2|3|4] [--root .]'
  ].join('\n'));
  process.exit(0);
}

const rootDir = resolve(arg('--root', process.cwd()));

if (has('--verify-all')) {
  const res = verifyProjectNotes(rootDir, { rerunCmds: has('--rerun') });
  if (!res.exists) {
    console.log('未发现 .donegate/notes.jsonl（无自定义补充条目）。\nRESULT: PASS');
    process.exit(0);
  }
  console.log(`核验自定义报喜/报忧条目：共 ${res.entries.length} 条（合法 ${res.valid.length}，拦截 ${res.invalid.length}）`);
  for (const b of res.invalid) {
    console.error(`  ✗ 第 ${b.lineNo} 行「${b.title}」→ ${b.reason}`);
  }
  if (!res.ok) {
    const code = res.invalid.some((x) => x.exitCode === 2) ? 2 : 1;
    console.error(`RESULT: FAIL 发现未验真、越权或被篡改条目（退 ${code}）`);
    process.exit(code);
  }
  console.log('RESULT: PASS 所有自定义报喜/报忧条目均过防撒谎门禁');
  process.exit(0);
}

if (has('--clear')) {
  const stg = arg('--stage');
  const stageNum = stg ? Number(stg) : null;
  clearCustomNotes(rootDir, stageNum);
  console.log(renderProgressBlock(rootDir, { headline: '🧹 已清理自定义补充条目 · 总进度 {{PCT}}' }));
  process.exit(0);
}

const kind = arg('--kind');
const stage = Number(arg('--stage'));
const title = arg('--title', '');
const detail = arg('--detail', '');
const verifyCmd = arg('--verify-cmd', '');
const evidence = arg('--evidence', '');

const res = appendProgressNote(rootDir, { kind, stage, title, detail, verifyCmd, evidence });
if (!res.ok) {
  console.error('门禁拦截：' + res.reason);
  process.exit(res.exitCode || 1);
}

const icon = kind === 'good' ? '✅' : (kind === 'alert' ? '🚨' : '⚠️');
const label = kind === 'good' ? '补充报喜（已验真）' : (kind === 'alert' ? '严重告警' : '报忧提醒');
console.log(renderProgressBlock(rootDir, {
  activeStage: stage,
  headline: `${icon} [阶段 ${stage} · ${label}] ${title} · 总进度 {{PCT}}`
}));
process.exit(0);
