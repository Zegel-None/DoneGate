#!/usr/bin/env node
// 进度卡片开放扩展入口：供用户自己的 AI Agent 在机械进度之外补充阶段性报喜或报忧
// 原则：补充内容存入 .donegate/notes.jsonl 并随卡片展示，但**绝不改变**机械计算的总进度百分比（INV-01）。
//
// 用法：
//   node skill/progress-note.mjs --kind good|worry|alert --stage 1|2|3|4 --title "简短标题" [--detail "补充说明"] [--root <项目根>]
//   node skill/progress-note.mjs --clear [--stage 1|2|3|4] [--root <项目根>]
// 退出码：0 成功并打印最新进度卡；1 参数不合法
import { resolve } from 'node:path';
import { appendProgressNote, clearCustomNotes, renderProgressBlock } from '../runner/core/progress.mjs';

const argv = process.argv.slice(2);
const arg = (k, d = null) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (k) => argv.includes(k);

if (has('--help') || has('-h') || argv.length === 0) {
  console.log([
    'DoneGate 进度卡片开放入口（Agent 自定义报喜 / 报忧）',
    '',
    '用法：',
    '  node skill/progress-note.mjs --kind good|worry|alert --stage 1|2|3|4 --title "简短一句话" [--detail "原因或下一步"] [--root <项目根>]',
    '  node skill/progress-note.mjs --clear [--stage 1|2|3|4] [--root <项目根>]'
  ].join('\n'));
  process.exit(0);
}

const rootDir = resolve(arg('--root', process.cwd()));

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

const res = appendProgressNote(rootDir, { kind, stage, title, detail });
if (!res.ok) {
  console.error('参数不合规：' + res.reason);
  process.exit(1);
}

const icon = kind === 'good' ? '✅' : (kind === 'alert' ? '🚨' : '⚠️');
const label = kind === 'good' ? '补充报喜' : (kind === 'alert' ? '严重告警' : '报忧提醒');
console.log(renderProgressBlock(rootDir, {
  activeStage: stage,
  headline: `${icon} [阶段 ${stage} · ${label}] ${title} · 总进度 {{PCT}}`
}));
process.exit(0);
