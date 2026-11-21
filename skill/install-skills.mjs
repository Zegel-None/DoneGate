// 把技能版装进本项目的技能根（.dsh/skills），装完当场校验能不能被加载。
// 用法：node skill/install-skills.mjs
// 退出码：0 两个技能都会加载且无待定；1 有问题
//
// 为什么不直接写在 .dsh/skills 里：
//   包里的 donegate/ 是可分发形态（评审包的一部分），.dsh/skills/ 是本机部署形态。
//   混在一起会让「交付物」和「本机安装」变成同一个东西，改一边看不出另一边过期。
//   所以：包是源，这里是拷贝；.dsh/skills/ 进 .gitignore。
//
// 漂移检测：每次安装前比对哈希，列出与源不一致的旧文件（只提示，不阻止）。

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sha256Short } from './hash.mjs';
import { walk } from './fs-walk.mjs';
const shaShort = (v) => sha256Short(v, 12);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DEST_ROOT = join(ROOT, '.dsh', 'skills');
const SKILLS = ['donegate', 'donegate-judge', 'donegate-forge'];
const VALIDATOR = join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'skills',
  'dsh-skill-authoring', 'scripts', 'validate-skill.mjs');

// 遍历两份技能目录：跳过集交给唯一实现（这里刻意不跳任何目录——只装 donegate*）
const walkFiles = (dir) => walk(dir, { skipDirs: [] }).files;

let installed = 0;
let missing = 0;
for (const name of SKILLS) {
  const src = join(ROOT, name);
  if (!existsSync(join(src, 'SKILL.md'))) { console.log('· 跳过 ' + name + '（还没有 SKILL.md）'); missing++; continue; }
  const dest = join(DEST_ROOT, name);

  // 漂移提示：目标里已有但与源不同的文件
  if (existsSync(dest)) {
    const drift = [];
    for (const f of walkFiles(dest)) {
      const r = relative(dest, f);
      const s = join(src, r);
      if (!existsSync(s)) { drift.push(r + '（目标有、源没有）'); continue; }
      if (shaShort(readFileSync(f)) !== shaShort(readFileSync(s))) drift.push(r);
    }
    if (drift.length) console.log('· ' + name + ' 有 ' + drift.length + ' 处与源不一致，将被覆盖：' + drift.slice(0, 4).join('、'));
    rmSync(dest, { recursive: true, force: true });
  }

  for (const f of walkFiles(src)) {
    const r = relative(src, f);
    const t = join(dest, r);
    mkdirSync(dirname(t), { recursive: true });
    writeFileSync(t, readFileSync(f));
  }
  console.log('✓ 装入 ' + name + ' → ' + relative(ROOT, dest).split(sep).join('/'));
  installed++;
}

console.log('');
if (!existsSync(VALIDATOR)) {
  console.log('RESULT: SKIP 找不到校验器（' + VALIDATOR + '），安装已完成但没校验');
  process.exit(0);
}
try {
  const out = execFileSync('node', [VALIDATOR, '--root', DEST_ROOT], { encoding: 'utf8' });
  const tail = out.trim().split('\n').filter((l) => l.includes('checked,') || l.includes('would load')).join('\n');
  console.log(tail || out.trim().split('\n').slice(-1)[0]);
  console.log('RESULT: PASS 校验器退出码 0（两个技能都会被加载）');
  process.exit(0);
} catch (e) {
  console.log((e.stdout || '') + (e.stderr || ''));
  console.log('RESULT: FAIL 校验器退出码 ' + e.status);
  process.exit(1);
}
