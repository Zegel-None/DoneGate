// skill/check-symbols.mjs 的红测：三条核心断言 + 负对照 + 行号位移免疫与函数内局部闭包隔离验证。
// 用法：node skill/symbols-fixtures.mjs
// 退出码：0 全过；1 有断言不成立
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from './assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(HERE, 'check-symbols.mjs');
const c = createChecks();
const ok = (n, cond, extra) => c.check(n, cond, extra);

const repo = mkdtempSync(join(tmpdir(), 'symbols-fixtures-'));
mkdirSync(join(repo, 'skill'), { recursive: true });
const write = (rel, body) => writeFileSync(join(repo, rel), body, 'utf8');
const run = (args) => spawnSync(process.execPath, [CHECKER, '--root', repo, ...args], { encoding: 'utf8' });

console.log('夹具：' + repo + '\n');

// ① 死代码：定义了没人用
write('skill/a.mjs', `function used() { return 1; }\nfunction neverUsed() { return 2; }\nconsole.log(used());\n`);
let r = run(['--gate']);
ok('① 零引用函数被抓到（exit 1）', r.status === 1, 'exit=' + r.status);
ok('① 报告里点名 neverUsed', r.stdout.includes('neverUsed'));

r = run(['--update-baseline']);
write('skill/a.mjs', `function used() { return 1; }\nfunction neverUsed() { return used() + 2; }\nconsole.log(used(), neverUsed());\n`);
r = run(['--gate']);
ok('① 修好后不再报（exit 0）', r.status === 0, 'exit=' + r.status);

// ② 同名不同体
write('skill/a.mjs', `const helper = (x) => x + 1;\nconsole.log(helper(1));\n`);
write('skill/b.mjs', `const helper = (x) => x + 1;\nconsole.log(helper(2));\n`);
r = run(['--update-baseline']);
ok('② 两份相同时不报（负对照）', run(['--gate']).status === 0);
write('skill/b.mjs', `const helper = (x) => x - 3;\nconsole.log(helper(2));\n`);
r = run(['--gate']);
ok('② 同名换实现被抓到（exit 1）', r.status === 1, 'exit=' + r.status);
ok('② 报告里点名 helper', r.stdout.includes('helper'));

// ⑥ 行号位移免疫：固化基线后在文件顶部插入多行注释与代码，函数体未变时绝不误报红灯
r = run(['--update-baseline']);
const padLines = Array.from({ length: 12 }, (_, i) => `// 新增前置说明行 ${i}`).join('\n');
write('skill/b.mjs', `${padLines}\nconst helper = (x) => x - 3;\nconsole.log(helper(2));\n`);
r = run(['--gate']);
ok('⑥ 行号下移 12 行但函数体未变时不误报（exit 0）', r.status === 0, 'exit=' + r.status);

// ⑦ 函数内部局部闭包与未导出 CLI 短名不跨文件误撞
write('skill/a.mjs', `export function runSuiteA() {\n  const innerStep = (v) => v + 1;\n  return innerStep(2);\n}\nconsole.log(runSuiteA());\n`);
write('skill/b.mjs', `export function runSuiteB() {\n  const innerStep = (v) => v * 10;\n  return innerStep(3);\n}\nconsole.log(runSuiteB());\n`);
r = run(['--update-baseline']);
write('skill/b.mjs', `export function runSuiteB() {\n  const innerStep = (v) => v * 99;\n  return innerStep(3);\n}\nconsole.log(runSuiteB());\n`);
r = run(['--gate']);
ok('⑦ 函数内部局部闭包修改不污染全局符号基线（exit 0）', r.status === 0, 'exit=' + r.status);

// ③ 同体不同名（换名复制）
write('skill/a.mjs', `const readTheThing = (p) => { const t = String(p); return t.trim().slice(0, 10); };\nconsole.log(readTheThing('x'));\n`);
write('skill/b.mjs', `const loadTheThing = (p) => { return String(p).toUpperCase().repeat(3); };\nconsole.log(loadTheThing('y'));\n`);
r = run(['--update-baseline']);
ok('③ 两个不同函数时不报（负对照）', run(['--gate']).status === 0);
write('skill/b.mjs', `const loadTheThing = (p) => { const t = String(p); return t.trim().slice(0, 10); };\nconsole.log(loadTheThing('y'));\n`);
r = run(['--gate']);
ok('③ 同体不同名被抓到（exit 1）', r.status === 1, 'exit=' + r.status);
ok('③ 报告里两个名字都在', r.stdout.includes('readTheThing') && r.stdout.includes('loadTheThing'));

// ④ 负对照：完全不同的函数不许误报
write('skill/a.mjs', `const alpha = (a) => a + 100;\nconsole.log(alpha(1));\n`);
write('skill/b.mjs', `const beta = (b) => b.toUpperCase() + '-x-'.repeat(2);\nconsole.log(beta('q'));\n`);
r = run(['--update-baseline']);
r = run(['--gate']);
ok('④ 两个无关函数不误报（exit 0）', r.status === 0, 'exit=' + r.status);

// ⑤ 长函数（>80 行）：只在第 80 行之后不同的两个函数不许误报
const longFn = (name, tail) => {
  const body = Array.from({ length: 82 }, (_, i) => '  const v' + i + ' = ' + i + ';').join('\n');
  return 'function ' + name + '() {\n' + body + "\n  return '" + tail + "';\n}\nconsole.log(" + name + '());\n';
};
write('skill/a.mjs', longFn('longAlpha', 'A'));
write('skill/b.mjs', longFn('longBeta', 'B'));
r = run(['--gate']);
ok('⑤ 长函数只差最后一行不误报（exit 0）', r.status === 0, 'exit=' + r.status);

rmSync(repo, { recursive: true, force: true });
c.summary('结果');
process.exit(c.bad ? 1 : 0);
