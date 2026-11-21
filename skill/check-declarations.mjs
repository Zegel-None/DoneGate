// 旁路检查层（按场景跑，不进十二条）：适配器九字段声明校验、核侧单进程哈希复算、契约查找与 --verify-adapters。
// 用法：
//   node skill/check-declarations.mjs                                      默认：自带夹具自检
//   node skill/check-declarations.mjs --verify-adapters [--offline]        真跑 tests/adapters/*/verify.mjs（--offline 仅跑离线必红夹具）
//   node skill/check-declarations.mjs --claim <claim.json> [--root <项目根>] [--skip-contract-lookup]
// 退出码（§八 四值）：0 通过 / 1 契约查找不匹配或夹具失败 / 2 协议违规或哈希不符 / 3 缺失、不可读或外部二进制未装。

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256 } from './hash.mjs';

const DECL_HERE = dirname(fileURLToPath(import.meta.url));
const DECL_REPO = resolve(DECL_HERE, '..');
const NINE_KEYS = ['stage', 'tool', 'version', 'role', 'inputs', 'artifacts', 'claims', 'unresolved', 'degradedTo'];
const FORBIDDEN_KEYS = new Set(['verdict', 'ok', 'clean', 'passed', 'failed', 'score', 'ratio', 'green', 'red', 'teeth']);
const HEX64_RE = /^[0-9a-f]{64}$/;

function findForbiddenKeysDeep(val, prefix = '') {
  const hits = [];
  if (Array.isArray(val)) {
    val.forEach((item, i) => { hits.push(...findForbiddenKeysDeep(item, `${prefix}[${i}]`)); });
  } else if (val && typeof val === 'object') {
    for (const [k, v] of Object.entries(val)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (FORBIDDEN_KEYS.has(k)) hits.push(p);
      hits.push(...findForbiddenKeysDeep(v, p));
    }
  }
  return hits;
}

function lookupContractObligation(projectRoot, checkedBy) {
  const [contractId, obligationId] = checkedBy.split('/');
  const contractsDir = join(projectRoot, 'contracts');
  const rootContract = join(projectRoot, 'contract.json');
  const hasDir = existsSync(contractsDir) && statSync(contractsDir).isDirectory();
  const hasRoot = existsSync(rootContract) && statSync(rootContract).isFile();
  if (hasDir && hasRoot) return { exitCode: 2, reason: '布局歧义：同时存在 contracts/ 与 ./contract.json' };
  if (!hasDir && !hasRoot) return { exitCode: 3, reason: '找不到 contracts/ 或 ./contract.json' };

  const targetFile = hasDir ? join(contractsDir, contractId, 'contract.json') : rootContract;
  if (!existsSync(targetFile)) return { exitCode: hasDir ? 1 : 3, reason: '契约文件不存在：' + targetFile };
  let doc;
  try { doc = JSON.parse(readFileSync(targetFile, 'utf8')); }
  catch { return { exitCode: 3, reason: '契约文件读不出或 JSON 损坏：' + targetFile }; }

  if (!hasDir && doc.id !== contractId) {
    return { exitCode: 1, reason: `根 contract.json id=${doc.id} 与 checkedBy=${contractId} 不匹配` };
  }
  const obs = Array.isArray(doc.obligations) ? doc.obligations : [];
  if (!obs.some((o) => o && o.id === obligationId)) {
    return { exitCode: 1, reason: `契约 ${contractId} 中找不到判据 ${obligationId}` };
  }
  return { exitCode: 0 };
}

export function verifyClaimInMemory(claimAbsPath, projectRoot, opts = {}) {
  if (!existsSync(claimAbsPath)) return { exitCode: 3, reason: 'claim.json 不存在：' + claimAbsPath };
  let claimBuf;
  try { claimBuf = readFileSync(claimAbsPath); }
  catch { return { exitCode: 3, reason: 'claim.json 不可读：' + claimAbsPath }; }

  let claim;
  try { claim = JSON.parse(claimBuf.toString('utf8')); }
  catch (e) { return { exitCode: 2, reason: 'claim.json JSON 解析失败：' + e.message }; }

  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    return { exitCode: 2, reason: 'claim.json 顶层必须是对象' };
  }
  const keys = Object.keys(claim);
  const missingKeys = NINE_KEYS.filter((k) => !(k in claim));
  const extraKeys = keys.filter((k) => !NINE_KEYS.includes(k));
  if (missingKeys.length || extraKeys.length) {
    return { exitCode: 2, reason: `违反严格九字段：缺 [${missingKeys.join(',')}] 多 [${extraKeys.join(',')}]` };
  }

  const forbidden = findForbiddenKeysDeep(claim);
  if (forbidden.length) return { exitCode: 2, reason: '出现协议禁词键名：' + forbidden.join('、') };

  if (!Number.isInteger(claim.stage) || claim.stage < 1 || claim.stage > 7) return { exitCode: 2, reason: 'stage 必须是 1-7 整数' };
  if (typeof claim.tool !== 'string' || !claim.tool.trim()) return { exitCode: 2, reason: 'tool 非法' };
  if (typeof claim.version !== 'string' || !claim.version.trim()) return { exitCode: 2, reason: 'version 非法' };
  if (claim.role !== 'hard' && claim.role !== 'soft') return { exitCode: 2, reason: 'role 必须是 hard 或 soft' };
  if (typeof claim.degradedTo !== 'string' || !claim.degradedTo.trim() || claim.degradedTo.trim() === '跳过') {
    return { exitCode: 2, reason: 'degradedTo 必须是非空退化说明且不能为「跳过」' };
  }
  if (!Array.isArray(claim.inputs) || !Array.isArray(claim.artifacts) || !Array.isArray(claim.claims) || !Array.isArray(claim.unresolved)) {
    return { exitCode: 2, reason: 'inputs / artifacts / claims / unresolved 必须是数组' };
  }

  for (const u of claim.unresolved) {
    if (!u || typeof u !== 'object' || typeof u.text !== 'string' || !u.text.trim() || !Number.isInteger(u.stage) || u.stage < 1 || u.stage > 7) {
      return { exitCode: 2, reason: 'unresolved 条目必须含 { text, stage(1-7) }' };
    }
  }

  // 单进程一次读入内存后立即重算 SHA-256，后续只消费内存对象
  const memFiles = new Map();
  for (const listName of ['inputs', 'artifacts']) {
    for (const item of claim[listName]) {
      if (!item || typeof item.path !== 'string' || !HEX64_RE.test(String(item.sha256 || ''))) {
        return { exitCode: 2, reason: `${listName} 条目缺少合法 path 或 64 位裸小写 sha256` };
      }
      const abs = resolve(projectRoot, item.path);
      if (!existsSync(abs)) return { exitCode: 3, reason: `${listName} 文件不存在：${item.path}` };
      let buf;
      try { buf = readFileSync(abs); }
      catch { return { exitCode: 3, reason: `${listName} 文件读不出：${item.path}` }; }
      const actualHash = sha256(buf);
      if (actualHash !== item.sha256) {
        return { exitCode: 2, reason: `${listName} 哈希不符 (${item.path})：声明=${item.sha256} 实算=${actualHash}` };
      }
      memFiles.set(item.path, buf);
      if (listName === 'artifacts' && item.kind && item.kind.endsWith('-observation')) {
        let obsParsed;
        try { obsParsed = JSON.parse(buf.toString('utf8')); }
        catch { return { exitCode: 2, reason: `observation 产物 JSON 损坏：${item.path}` }; }
        const obsForbidden = findForbiddenKeysDeep(obsParsed);
        if (obsForbidden.length) return { exitCode: 2, reason: `observation 含协议禁词：${obsForbidden.join('、')}` };
      }
    }
  }

  for (const cl of claim.claims) {
    if (!cl || typeof cl !== 'object' || Array.isArray(cl)) return { exitCode: 2, reason: 'claims 条目必须是对象' };
    const cKeys = Object.keys(cl).sort();
    if (cKeys.length !== 2 || cKeys[0] !== 'checkedBy' || cKeys[1] !== 'text' || typeof cl.text !== 'string' || !cl.text.trim()) {
      return { exitCode: 2, reason: 'claims 条目严格且仅含 { text, checkedBy }' };
    }
    if (typeof cl.checkedBy !== 'string' || !/^[^/]+\/[^/]+$/.test(cl.checkedBy)) {
      return { exitCode: 2, reason: 'checkedBy 语法非法（必须为 <contractId>/<obligationId>）：' + cl.checkedBy };
    }
    if (!opts.skipContractLookup) {
      const look = lookupContractObligation(projectRoot, cl.checkedBy);
      if (look.exitCode !== 0) return look;
    }
  }

  return { exitCode: 0, claim, memFiles, unresolvedCount: claim.unresolved.length };
}

function runVerifyAdapters(offlineOnly = false) {
  const adpDir = join(DECL_REPO, 'tests', 'adapters');
  if (!existsSync(adpDir)) { console.error('没有 tests/adapters 目录'); return 3; }
  const suites = readdirSync(adpDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(adpDir, e.name, 'verify.mjs')))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({ name: e.name, path: join(adpDir, e.name, 'verify.mjs') }));
  if (suites.length === 0) { console.error('tests/adapters 下没有任何 verify.mjs'); return 3; }

  let failedSuites = 0;
  let accidentSuites = 0;
  const missingBinTools = [];
  const childArgs = offlineOnly ? ['--offline'] : [];
  for (const s of suites) {
    console.log('>>> node ' + s.path + (offlineOnly ? ' --offline' : ''));
    const r = spawnSync(process.execPath, [s.path, ...childArgs], {
      cwd: DECL_REPO,
      env: offlineOnly ? { ...process.env, DONEGATE_OFFLINE_FIXTURES: '1' } : process.env,
      encoding: 'utf8'
    });
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    if (r.status === 2) accidentSuites++;
    else if (r.status === 3) missingBinTools.push(s.name);
    else if (r.status !== 0) failedSuites++;
  }
  const selfTest = join(adpDir, 'run-stage-self-test.mjs');
  if (existsSync(selfTest)) {
    console.log('>>> node ' + selfTest);
    const rs = spawnSync(process.execPath, [selfTest], { cwd: DECL_REPO, encoding: 'utf8' });
    process.stdout.write(rs.stdout || '');
    process.stderr.write(rs.stderr || '');
    if (rs.status === 2) accidentSuites++;
    else if (rs.status !== 0) failedSuites++;
  }

  if (accidentSuites > 0) {
    console.log(`\nRESULT: FAIL ${accidentSuites} 套夹具触发协议事故（退 2）`);
    return 2;
  }
  if (failedSuites > 0) {
    console.log(`\nRESULT: FAIL ${failedSuites} 套夹具断言未过（退 1）`);
    return 1;
  }
  if (missingBinTools.length > 0) {
    console.log(`\nRESULT: 无法判断 离线必红夹具已全过，但本机缺少 ${missingBinTools.length} 个外部二进制（${missingBinTools.join(', ')}），按 §八 退 3`);
    return 3;
  }
  console.log(offlineOnly
    ? '\nRESULT: PASS 离线必红夹具与执行器反例全部通过'
    : '\nRESULT: PASS 全部适配器必红夹具与执行器反例通过');
  return 0;
}

function runDeclSelfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'decl-self-'));
  let failCount = 0;
  const assertCase = (label, cond) => {
    console.log('  ' + (cond ? '✓' : '✗') + ' ' + label);
    if (!cond) failCount++;
  };
  try {
    mkdirSync(join(tmp, 'contracts/c01'), { recursive: true });
    writeFileSync(join(tmp, 'contracts/c01/contract.json'), JSON.stringify({ id: 'c01', obligations: [{ id: 'o1' }] }));
    const srcBuf = Buffer.from('export const x = 1;\n', 'utf8');
    writeFileSync(join(tmp, 'src.mjs'), srcBuf);
    const obsBuf = Buffer.from(JSON.stringify({ total: 1 }) + '\n', 'utf8');
    writeFileSync(join(tmp, 'obs.json'), obsBuf);
    const baseClaim = {
      stage: 4, tool: 'stryker', version: '10.1.1', role: 'hard',
      inputs: [{ path: 'src.mjs', sha256: sha256(srcBuf) }],
      artifacts: [{ path: 'obs.json', sha256: sha256(obsBuf), kind: 'stryker-observation' }],
      claims: [{ text: 'ok', checkedBy: 'c01/o1' }],
      unresolved: [], degradedTo: '人工按同一格式手写'
    };
    const p = join(tmp, 'claim.json');
    writeFileSync(p, JSON.stringify(baseClaim));
    assertCase('合法九字段 + 哈希一致 + 契约命中 → 0', verifyClaimInMemory(p, tmp).exitCode === 0);
    writeFileSync(p, JSON.stringify({ ...baseClaim, verdict: 'pass' }));
    assertCase('十字段 + 禁词 verdict → 2', verifyClaimInMemory(p, tmp).exitCode === 2);
    writeFileSync(p, JSON.stringify({ ...baseClaim, inputs: [{ path: 'src.mjs', sha256: '0'.repeat(64) }] }));
    assertCase('核侧复算哈希不符 → 2', verifyClaimInMemory(p, tmp).exitCode === 2);
    writeFileSync(p, JSON.stringify({ ...baseClaim, inputs: [{ path: 'missing.mjs', sha256: '0'.repeat(64) }] }));
    assertCase('声明文件缺失 → 3', verifyClaimInMemory(p, tmp).exitCode === 3);
    writeFileSync(p, JSON.stringify({ ...baseClaim, claims: [{ text: 'x', checkedBy: 'c01/missing-o' }] }));
    assertCase('查无 obligationId → 1', verifyClaimInMemory(p, tmp).exitCode === 1);
    writeFileSync(p, JSON.stringify(baseClaim));
    writeFileSync(join(tmp, 'contract.json'), JSON.stringify({ id: 'c01', obligations: [{ id: 'o1' }] }));
    assertCase('contracts/ 与 ./contract.json 并存歧义 → 2', verifyClaimInMemory(p, tmp).exitCode === 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failCount === 0 ? '\nRESULT: PASS check-declarations 自检全过' : `\nRESULT: FAIL ${failCount} 项未过`);
  return failCount === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--verify-adapters')) process.exit(runVerifyAdapters(argv.includes('--offline')));
  const cIdx = argv.indexOf('--claim');
  if (cIdx >= 0) {
    const claimArg = argv[cIdx + 1];
    if (!claimArg) { console.error('缺少 --claim <path>'); process.exit(3); }
    const rIdx = argv.indexOf('--root');
    const root = rIdx >= 0 && argv[rIdx + 1] ? resolve(argv[rIdx + 1]) : DECL_REPO;
    const res = verifyClaimInMemory(resolve(claimArg), root, { skipContractLookup: argv.includes('--skip-contract-lookup') });
    if (res.exitCode === 0) {
      console.log(`RESULT: PASS 声明合法（unresolved=${res.unresolvedCount}）`);
    } else {
      console.error(res.reason);
      console.log(`RESULT: ${res.exitCode === 3 ? '无法判断' : 'FAIL'} ${res.reason}`);
    }
    process.exit(res.exitCode);
  }
  process.exit(runDeclSelfTest());
}
