// 正式采证入口（Mortar Protocol v1.1 §4.5 & §7.2）：
// 同一次运行内：检查干净工作区 → 清理旧产物 → 调用适配器 → 核侧单进程复算校验声明。
// 用法：node runner/run-stage.mjs --registry-id <id> [--root <dir>] [--adapter <path>] [--out <claim.json>] [...透传给适配器]
// 退出码（§八）：0 合法声明已落盘 / 2 协议事故（含拦截禁词） / 3 脏树或上游故障（原样透传，绝不吞码）。
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJsonStrict } from '../skill/io.mjs';
import { verifyClaimInMemory } from '../skill/check-declarations.mjs';
import { renderProgressBlock } from './core/progress.mjs';

const STAGE_HERE = dirname(fileURLToPath(import.meta.url));
const STAGE_REPO = resolve(STAGE_HERE, '..');

const argv = process.argv.slice(2);
const pullOpt = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const rootDir = resolve(pullOpt('--root') || process.cwd());
const registryId = pullOpt('--registry-id');
if (!registryId) { console.error('缺少 --registry-id'); process.exit(2); }

// 1. 干净树门禁：工作区脏即退 3
const st = spawnSync('git', ['-C', rootDir, 'status', '--porcelain'], { encoding: 'utf8' });
if (st.status !== 0 || st.stdout.trim() !== '') {
  console.error('run-stage 拒收：工作区存在未提交改动或非 git 仓库（退 3）');
  process.exit(3);
}

// 2. 从 registry 查入口（除非 --adapter 指定测试假适配器）
const regFile = existsSync(join(rootDir, 'adapters.registry.json')) ? join(rootDir, 'adapters.registry.json') : join(STAGE_REPO, 'adapters.registry.json');
const regRes = readJsonStrict(regFile);
if (!regRes.ok) { console.error('adapters.registry.json 不可读或损坏'); process.exit(regRes.error === 'parse' ? 2 : 3); }
const regEntry = Array.isArray(regRes.value.adapters) ? regRes.value.adapters.find((a) => a.id === registryId) : null;
const adapterOverride = pullOpt('--adapter');
if (!regEntry && !adapterOverride) { console.error('未登记 --registry-id：' + registryId); process.exit(2); }

const toolName = regEntry ? regEntry.tool : registryId.split('@')[0];
const adapterAbs = resolve(adapterOverride || join(STAGE_REPO, regEntry.entry));
const outRel = pullOpt('--out') || `.donegate/adapters/${toolName}/claim.json`;
const outAbs = resolve(rootDir, outRel);

// 3. 先清旧产物，杜绝陈旧报告背书新提交（§4.5）
const outDir = dirname(outAbs);
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// 4. 构造透传参数并运行适配器（直跑 node，绝不吞码）
const passArgs = [adapterAbs, '--root', rootDir, '--registry-id', registryId, '--out', outRel];
for (let i = 0; i < argv.length; i++) {
  if (['--root', '--registry-id', '--adapter', '--out'].includes(argv[i])) { i++; continue; }
  passArgs.push(argv[i]);
}
const adpRes = spawnSync(process.execPath, passArgs, { cwd: rootDir, encoding: 'utf8' });
if (adpRes.stdout) process.stdout.write(adpRes.stdout);
if (adpRes.stderr) process.stderr.write(adpRes.stderr);
if (adpRes.status !== 0) {
  process.exit(typeof adpRes.status === 'number' ? adpRes.status : 3);
}

// 5. 核侧单进程核验 claim.json（拦禁词、九字段与哈希复算）
const check = verifyClaimInMemory(outAbs, rootDir, { skipContractLookup: true });
if (check.exitCode !== 0) {
  console.error('run-stage 拦截非法声明：' + check.reason);
  process.exit(check.exitCode);
}
console.log(`RESULT: PASS run-stage 采证与声明核验通过（${toolName}）`);
if (existsSync(join(rootDir, 'INTENT.md')) && existsSync(join(rootDir, '.donegate', 'chain.jsonl'))) {
  console.log('\n' + renderProgressBlock(rootDir, { headline: `✅ [3-2] 外部工具 ${toolName} 体检入账完成 · 总进度 {{PCT}}` }));
}
process.exit(0);
