// DoneGate V4 十二条命令与密封胶囊 V2 / 单卡微门禁端到端红绿夹具
// 用法：node runner/donegate-fixtures.mjs
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createChecks } from '../skill/assert.mjs';
import { dispatchCommand } from './donegate.mjs';
import * as coreContract from './core/contract.mjs';
import * as coreIndex from './core/index.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'donegate.mjs');
const c = createChecks();
const tmp = mkdtempSync(join(tmpdir(), 'dg-all-'));

function runDg(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}

function runCapsuleAndStubUpgradeChecks(projRoot) {
  // A. isolation.mjs: buildSanitizedEnv 保留合法可执行 TMPDIR、支持 extra 覆盖、异常自动回退 .donegate/tmp
  const execTmp = join(projRoot, 'custom-exec-tmp');
  mkdirSync(execTmp, { recursive: true });
  const keptEnv = coreIndex.buildSanitizedEnv({ PATH: process.env.PATH || '', TMPDIR: execTmp }, {}, { cwd: projRoot });
  const overrideEnv = coreIndex.buildSanitizedEnv({ PATH: process.env.PATH || '', TMPDIR: execTmp }, { TMPDIR: '/custom-override-tmp' }, { cwd: projRoot });
  const missingEnv = coreIndex.buildSanitizedEnv({ PATH: process.env.PATH || '' }, {}, { cwd: projRoot });
  const roDir = join(projRoot, 'readonly-tmp');
  mkdirSync(roDir, { recursive: true });
  chmodSync(roDir, 0o555);
  const roFallbackEnv = coreIndex.buildSanitizedEnv({ PATH: process.env.PATH || '', TMPDIR: roDir }, {}, { cwd: projRoot });
  chmodSync(roDir, 0o755);
  const expectedFallback = join(projRoot, '.donegate', 'tmp');
  c.check(
    'buildSanitizedEnv 保留可执行 TMPDIR、支持 extra 覆盖，缺失或不可执行时自动回退 .donegate/tmp',
    keptEnv.TMPDIR === execTmp &&
      overrideEnv.TMPDIR === '/custom-override-tmp' &&
      missingEnv.TMPDIR === expectedFallback &&
      existsSync(expectedFallback) &&
      coreIndex.probeExecutableTmpDir(expectedFallback) === true &&
      (process.platform === 'win32' || roFallbackEnv.TMPDIR === expectedFallback)
  );

  // B. 构造双卡实验仓（api-hub 桶门面 + HTTP 路由；ui-deck 浏览器拼接脚本 + @subpack + 双指标模板）
  const v2 = join(projRoot, 'capsule-v2-lab');
  mkdirSync(join(v2, 'src/api'), { recursive: true });
  mkdirSync(join(v2, 'runner/atlas'), { recursive: true });
  mkdirSync(join(v2, 'workflows'), { recursive: true });
  writeFileSync(join(v2, '.gitignore'), '.donegate/\n');
  writeFileSync(join(v2, 'AGENTS.md'), '# 共享治理规范\n');
  writeFileSync(join(v2, 'workflows/preset.json'), '{"name":"标准工作流"}\n');

  writeFileSync(join(v2, 'src/api/impl.mjs'), [
    '/** @typedef {{ slotId: string, ok: boolean }} SlotResult */',
    '/**',
    ' * 查询预约槽位详情',
    ' * @param {string} slotId',
    ' * @param {{ strict?: boolean }} [opts]',
    ' * @returns {Promise<SlotResult>}',
    ' */',
    'export async function fetchSlotDetail(slotId, opts = { strict: true }) { return { slotId, ok: Boolean(opts.strict) }; }',
    ''
  ].join('\n'));
  writeFileSync(join(v2, 'src/api/mid.mjs'), 'export { fetchSlotDetail } from "./impl.mjs";\n');
  writeFileSync(join(v2, 'src/api/contract.mjs'), 'export { fetchSlotDetail as loadSlot } from "./mid.mjs";\n');
  writeFileSync(join(v2, 'src/api/routes.mjs'), [
    'export function handleSlotRoutes(req, res, pathname) {',
    '  if (req.method === "GET" && pathname === "/donegate/api/slots/list") return res.end("[]");',
    '  if (pathname === "/donegate/api/slots/book") { if (req.method !== "POST") return res.end("405"); return res.end("ok"); }',
    '}',
    ''
  ].join('\n'));
  writeFileSync(join(v2, 'src/api/index.mjs'), 'export * from "./contract.mjs";\nexport { handleSlotRoutes } from "./routes.mjs";\n');
  writeFileSync(join(v2, 'src/api/verify-env.mjs'), 'if (process.env.DONEGATE_MICRO_GATE !== "1" || process.env.DONEGATE_MICRO_NODE !== "api-hub") process.exit(1);\nconsole.log("env-ok");\n');

  const tplLines = Array.from({ length: 15 }, (_, idx) => `  <div class="row-${idx}">静态模板行 ${idx}</div>`).join('\n');
  const joinLines = Array.from({ length: 15 }, (_, idx) => `    '静态拼接行-${idx}'`).join(',\n');
  writeFileSync(join(v2, 'runner/atlas/contract.mjs'), [
    'export const ATLAS_SUBPACKS = { "@scanner": ["runner/atlas/scan-mini.mjs"], "@uiboard": ["runner/atlas/wb-trigger.mjs"] };',
    'export { scanMini } from "./scan-mini.mjs";',
    ''
  ].join('\n'));
  writeFileSync(join(v2, 'runner/atlas/index.mjs'), 'export * from "./contract.mjs";\n');
  writeFileSync(join(v2, 'runner/atlas/scan-mini.mjs'), 'export function scanMini(rootDir) { return rootDir; }\n');
  writeFileSync(join(v2, 'runner/atlas/wb-trigger.mjs'), [
    'export function renderTriggerButton(wb) {',
    '  wb.state.lastView = "main";',
    '  wb.openSlotDrawer("s1");',
    '  return \'<button id="dg-slot-btn" data-action="open-slot-drawer" style="color:#fff;background:#0f172a">打开项目</button>\';',
    '}',
    ''
  ].join('\n'));
  writeFileSync(join(v2, 'runner/atlas/wb-handler.mjs'), [
    'export function bindSlotEvents(wb, action) {',
    '  wb.openSlotDrawer = function openSlotDrawer(id) { return document.getElementById("dg-slot-btn") || id; };',
    '  if (action === "open-slot-drawer") return document.querySelector("#dg-slot-btn");',
    '  return null;',
    '}',
    ''
  ].join('\n'));
  writeFileSync(join(v2, 'runner/atlas/wb-ortho.mjs'), [
    'export function renderOrthoStaticTemplate(wb) {',
    '  wb.state.theme = "#ffffff";',
    '  wb.refreshOrthoBadge = () => "LEXICAL_SPECIAL_NEEDLE";',
    '  const html = String.raw`',
    '    <section id="ortho-box" data-action="toggle-ortho" style="border-color:#abcdef">',
    tplLines,
    '    </section>',
    '  `;',
    '  const css = [',
    joinLines,
    '  ].join("\\n");',
    '  return html + css;',
    '}',
    ''
  ].join('\n'));

  dispatchCommand(['init', '.'], v2);
  dispatchCommand(['contract', 'new', 'api-hub', '--title', '接口中枢', '--scope', 'src/api/'], v2);
  dispatchCommand(['contract', 'new', 'ui-deck', '--title', '画布面板', '--scope', 'runner/atlas/', '--depends-on', 'api-hub'], v2);
  const apiContractPath = join(v2, 'contracts/api-hub/contract.json');
  const apiContract = JSON.parse(readFileSync(apiContractPath, 'utf8'));
  apiContract.why = '提供预约槽位契约与微门禁环境隔离验证。';
  apiContract.obligations = [{
    id: 'micro-env-probe', kind: 'command', command: 'node src/api/verify-env.mjs',
    expect: { exitCode: 0, stdoutMatches: 'env-ok' }, required: true,
    claim: '微门禁注入 DONEGATE_MICRO_GATE 与 DONEGATE_MICRO_NODE', observable: 'env-ok', scope: '仅单卡判据'
  }];
  writeFileSync(apiContractPath, JSON.stringify(apiContract, null, 2));

  // C. 验证 1-Hop 桶门面解引用（多跳参数列表 + @typedef/@param/@returns）与 HTTP Route Contracts + ROUTER.md 共享治理段
  const slUi = dispatchCommand(['slice', 'ui-deck', '--focus', '@uiboard'], v2);
  const apiStubText = readFileSync(join(v2, '.donegate/stubs/api-hub.stub.d.ts'), 'utf8');
  const routerText = readFileSync(join(v2, '.donegate/ROUTER.md'), 'utf8');
  c.check(
    '1-Hop barrel 存根多跳解引用真实参数列表与 @typedef/@param/@returns JSDoc 且生成 HTTP Route Contracts',
    apiStubText.includes('export async function loadSlot(slotId, opts = { strict: true });') &&
      apiStubText.includes('@typedef') &&
      apiStubText.includes('@returns {Promise<SlotResult>}') &&
      apiStubText.includes('// === HTTP Route Contracts ===') &&
      apiStubText.includes('// GET /donegate/api/slots/list [src/api/routes.mjs]') &&
      apiStubText.includes('// POST /donegate/api/slots/book [src/api/routes.mjs]')
  );
  c.check(
    'SHARED_GOVERNANCE_GLOBS 覆盖 13 类以上路径且 ROUTER.md 末尾输出共享治理说明',
    coreIndex.SHARED_GOVERNANCE_GLOBS.length >= 13 &&
      coreIndex.isSharedGovernanceFile('workflows/preset.json') &&
      coreIndex.isSharedGovernanceFile('AGENTS.md') &&
      routerText.includes('共享治理与跨切面') &&
      routerText.includes('--allow-cross-scope')
  );

  // D. 验证 @subpack 焦点别名、DOM/action/wb 隐式耦合自动展开、正交兄弟表面索引（过滤 #fff 颜色）与双指标对齐
  const zeroPaths = slUi.capsule.zeroHopFiles.map((f) => f.path);
  const orthoStub = slUi.capsule.siblingStubFiles.find((f) => f.path === 'runner/atlas/wb-ortho.mjs');
  c.check(
    '@subpack 展开目标文件且 DOM/data-action/wb.* 隐式耦合兄弟自动拉入 0-Hop，正交兄弟输出表面索引并排除 #fff 颜色',
    slUi.exitCode === 0 &&
      zeroPaths.includes('runner/atlas/wb-trigger.mjs') &&
      zeroPaths.includes('runner/atlas/wb-handler.mjs') &&
      !zeroPaths.includes('runner/atlas/wb-ortho.mjs') &&
      slUi.stdout.includes('// [DOM & Action Wiring] wbDefs=[refreshOrthoBadge] actions=[toggle-ortho] domIds=[ortho-box]') &&
      !slUi.stdout.includes('domIds=[fff') &&
      Boolean(orthoStub && orthoStub.physicalLines >= 35 && orthoStub.maxProceduralFnLines <= 10)
  );

  // E. 验证跨卡 --focus 显式告警与 --lexical 词法命中提升（含预算保护与不存在路径必红退 3）
  const slCross = dispatchCommand(['slice', 'ui-deck', '--focus', 'wb-trigger.mjs,src/api/impl.mjs,workflows/preset.json', '--lexical', 'LEXICAL_SPECIAL_NEEDLE'], v2);
  const slBudgetGuard = dispatchCommand(['slice', 'ui-deck', '--lexical', 'LEXICAL_SPECIAL_NEEDLE', '--max-tokens', '5'], v2);
  const slBogus = dispatchCommand(['slice', 'ui-deck', '--focus', 'nonexistent-ghost-file.mjs'], v2);
  c.check(
    '跨卡 --focus 写入 warnings[] 与胶囊顶部提示，--lexical 自动提升命中存根且受预算保护，无效焦点退 3',
    slCross.exitCode === 0 &&
      slCross.warnings.length === 2 &&
      slCross.stdout.includes('> ⚠️ 跨卡焦点路由提示') &&
      slCross.stdout.includes('node runner/donegate.mjs slice api-hub --focus src/api/impl.mjs') &&
      slCross.capsule.zeroHopFiles.some((f) => f.path === 'runner/atlas/wb-ortho.mjs') &&
      slBudgetGuard.capsule.truncatedFiles.includes('runner/atlas/wb-ortho.mjs') &&
      slBogus.exitCode === 3
  );
  return v2;
}

function runMicroGateGitDeltaChecks(v2) {
  // F. 验证 check-node 提交后分支增量感知、--base、--allow-cross-scope 与 contract.mjs / index.mjs 同步导出
  spawnSync('git', ['-C', v2, 'init', '-q', '-b', 'main']);
  spawnSync('git', ['-C', v2, 'config', 'user.email', 'dg@local']);
  spawnSync('git', ['-C', v2, 'config', 'user.name', 'DG']);
  spawnSync('git', ['-C', v2, 'add', '.']);
  spawnSync('git', ['-C', v2, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'chore: base main']);
  const mainHead = spawnSync('git', ['-C', v2, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

  spawnSync('git', ['-C', v2, 'checkout', '-q', '-b', 'feat/api-slot-upgrade']);
  writeFileSync(join(v2, 'src/api/impl.mjs'), readFileSync(join(v2, 'src/api/impl.mjs'), 'utf8') + '\nexport const SLOT_VER = 2;\n');
  spawnSync('git', ['-C', v2, 'add', 'src/api/impl.mjs']);
  spawnSync('git', ['-C', v2, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'feat(api): add slot version']);

  const chkCommitted = dispatchCommand(['check-node', 'api-hub', '--allow-stub-change', '--receipt'], v2);
  const rcpt1 = JSON.parse(readFileSync(join(v2, '.donegate/capsules/api-hub.receipt.json'), 'utf8'));
  c.check(
    'check-node 提交后干净树自动识别 main 分支增量（touchedFiles/committedFiles 非空）且注入微门禁环境变量通过',
    chkCommitted.exitCode === 0 &&
      rcpt1.baseRef === mainHead &&
      rcpt1.committedFiles.includes('src/api/impl.mjs') &&
      rcpt1.touchedFiles.includes('src/api/impl.mjs') &&
      rcpt1.uncommittedFiles.length === 0
  );

  writeFileSync(join(v2, 'AGENTS.md'), '# 共享治理规范\n新增跨切面协作条款\n');
  spawnSync('git', ['-C', v2, 'add', 'AGENTS.md']);
  spawnSync('git', ['-C', v2, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'docs: update shared agents']);

  const chkBlocked = dispatchCommand(['check-node', 'api-hub', '--receipt'], v2);
  const chkAllowed = dispatchCommand(['check-node', 'api-hub', '--allow-cross-scope', '--base', 'HEAD~2', '--receipt'], v2);
  const rcpt2 = JSON.parse(readFileSync(join(v2, '.donegate/capsules/api-hub.receipt.json'), 'utf8'));
  const requiredExports = [
    'buildSanitizedEnv', 'probeExecutableTmpDir', 'enrichBarrelFacadeExports', 'extractHttpRouteContracts',
    'buildDomWiringGraph', 'computeFileLineMetrics', 'resolveSubpackFocusPatterns',
    'SHARED_GOVERNANCE_GLOBS', 'isSharedGovernanceFile', 'parseFocusPatterns', 'parseLexicalTerms', 'collectGitNodeChanges'
  ];
  c.check(
    'check-node 默认必红拦截跨切面文件，开启 --allow-cross-scope 放行并审计记录 crossScopeFiles[]，且 contract/index 导出对齐',
    chkBlocked.exitCode === 1 &&
      chkAllowed.exitCode === 0 &&
      rcpt2.crossScopeAllowed === true &&
      rcpt2.crossScopeFiles.includes('AGENTS.md') &&
      rcpt2.baseRef === mainHead &&
      requiredExports.every((k) => coreContract[k] !== undefined && coreIndex[k] !== undefined)
  );
}

try {
  const proj = join(tmp, 'studio');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, '.gitignore'), '.donegate/\nHANDOVER.md\n');
  mkdirSync(join(proj, 'src/format'), { recursive: true });
  writeFileSync(join(proj, 'src/format/time.mjs'), 'export const fmt = (n) => String(n).padStart(2, "0");\n');
  writeFileSync(join(proj, 'src/format/check.mjs'), 'import { fmt } from "./time.mjs";\nif (fmt(5) !== "05") process.exit(1);\nconsole.log("05");\n');

  // 1. init & 重复 init 退 3
  const rInit1 = runDg(['init', '.'], proj);
  const rInit2 = runDg(['init', '.'], proj);
  c.check('init 建库退 0，已存在再 init 退 3（不覆盖）', rInit1.status === 0 && rInit2.status === 3, `r1=${rInit1.status} r2=${rInit2.status}`);

  // 2. contract new & 重复退 1
  const rNew1 = runDg(['contract', 'new', 'slot-format', '--title', '时间格式化', '--scope', 'src/format/'], proj);
  const rNew2 = runDg(['contract', 'new', 'slot-format', '--title', '重复'], proj);
  c.check('contract new 退 0，重复创建退 1', rNew1.status === 0 && rNew2.status === 1);

  // 空契约 status 报「未定验收」（INV-03）
  const stEmpty = dispatchCommand(['status'], proj);
  c.check('INV-03 空契约显示「未定验收」不写 0/0', stEmpty.exitCode === 0 && !stEmpty.stdout.includes('0/0') && stEmpty.stdout.includes('未定验收'));

  // 3. 写判据（含 1 条 command + 1 条 human）并冻结
  const cPath = join(proj, 'contracts/slot-format/contract.json');
  const cJson = JSON.parse(readFileSync(cPath, 'utf8'));
  cJson.why = '格式化错了会让预约时段展示错乱。';
  cJson.obligations = [
    {
      id: 'fmt-pad',
      kind: 'command',
      command: 'node src/format/check.mjs',
      expect: { exitCode: 0, stdoutMatches: '05' },
      required: true,
      claim: '个位数补零成两位',
      observable: 'stdout === "05"',
      scope: '不覆盖时区转换',
      inputClasses: ['正常'],
      servesSuccessCriterion: '客户能看懂时段',
      breakPatch: { file: 'src/format/time.mjs', from: 'padStart(2, "0")', to: 'padStart(1, "0")' }
    },
    {
      id: 'fmt-human',
      kind: 'human',
      expect: { standard: '人工确认时段显示清晰' },
      required: true,
      claim: '展示直观',
      observable: '界面无歧义',
      scope: '不覆盖英文环境',
      inputClasses: ['边界'],
      servesSuccessCriterion: '客户能看懂时段'
    }
  ];
  writeFileSync(cPath, JSON.stringify(cJson, null, 2));

  spawnSync('git', ['-C', proj, 'init', '-q']);
  spawnSync('git', ['-C', proj, 'config', 'user.email', 'dg@local']);
  spawnSync('git', ['-C', proj, 'config', 'user.name', 'DG']);
  spawnSync('git', ['-C', proj, 'add', '.']);
  spawnSync('git', ['-C', proj, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  // 4. contract freeze
  const rFreeze = runDg(['contract', 'freeze', 'slot-format', '--by', '店主'], proj);
  c.check('contract freeze 写入 frozenHash 并记链退 0', rFreeze.status === 0 && rFreeze.stdout.includes('frozenHash='));
  spawnSync('git', ['-C', proj, 'add', '.']);
  spawnSync('git', ['-C', proj, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'freeze']);

  // 5. check（干净树）+ teeth（档 A）
  const rCheck = runDg(['check', 'slot-format', '--human-pass'], proj);
  const rTeeth = runDg(['teeth', 'slot-format', 'fmt-pad', '--tier', 'A'], proj);
  c.check('check 跑通写三件套退 0，teeth 档 A killed 退 0', rCheck.status === 0 && rTeeth.status === 0 && rTeeth.stdout.includes('killed'), `chk=${rCheck.status} teeth=${rTeeth.status} ${rTeeth.stderr}`);

  // 6. status（INV-11 独立人工列 + 六栏相加=N + 通过四分）+ --tree + --html + graph + gaps
  writeFileSync(join(proj, 'functions/fn-fmt.json'), JSON.stringify({
    id: 'fn-fmt', title: '显示预约时间', successCriterion: '客户能看懂时段', contracts: ['slot-format'], source: '店主原话：客户要能看懂时间。'
  }));
  const rStatus = runDg(['status', '--tree', '--flow', '--html', '.donegate/status.html'], proj);
  c.check('status 输出六栏总账、通过四分、独立人工列、功能树、流程图、隔离提示与 HTML',
    rStatus.status === 0 && rStatus.stdout.includes('算数 1') && rStatus.stdout.includes('人工判据：1/1') &&
    rStatus.stdout.includes('本次运行无隔离') && existsSync(join(proj, '.donegate/status.html')),
    rStatus.stderr);

  const rGraph = runDg(['graph'], proj);
  c.check('graph 覆盖率 100% 出 一档图 + 三色计数 退 0', rGraph.status === 0 && rGraph.stdout.includes('一档图') && rGraph.stdout.includes('实线 0 条'));

  // 7. verify pack & verify apply（含 G-02 矛盾退 2、篡改退 2、pass 退 0）& signoff
  const pkRes = dispatchCommand(['verify', 'pack', 'slot-format'], proj);
  c.check('verify pack 自建复核包并过 check-reviewpack 退 0', pkRes.exitCode === 0 && existsSync(join(pkRes.packDir, 'MANIFEST.txt')), pkRes.stderr);

  const vPass = join(tmp, 'verdict-pass.json');
  writeFileSync(vPass, JSON.stringify({ contractId: 'slot-format', V1: 'pass', V2: 'pass', V3: 'pass', V4: 'pass', V5: 'pass' }));
  const rApplyPass = runDg(['verify', 'apply', pkRes.packDir, '--verdict', vPass], proj);
  c.check('verify apply 五项全 pass 退 0', rApplyPass.status === 0, rApplyPass.stderr);

  const vContra = join(tmp, 'verdict-contra.json');
  writeFileSync(vContra, JSON.stringify({ contractId: 'slot-format', V1: { verdict: 'unknown', reason: '声称改1个文件但diff显示3个，材料自相矛盾' }, V2: 'pass', V3: 'pass', V4: 'pass', V5: 'pass' }));
  const rApplyContra = runDg(['verify', 'apply', pkRes.packDir, '--verdict', vContra], proj);
  c.check('verify apply 矛盾退 2 (G-02)', rApplyContra.status === 2, `got=${rApplyContra.status}`);

  const rSignoff = runDg(['contract', 'freeze', 'slot-format', '--by', '店主', '--signoff', '--attest', '只负责两位补零格式化，不碰时区'], proj);
  c.check('contract freeze --signoff 通关退 0', rSignoff.status === 0 && rSignoff.stdout.includes('通关'), rSignoff.stderr);

  // 8. handover 六节齐
  const rHo = runDg(['handover', '--receiver', 'session-b', '--observed-output', 'PASS'], proj);
  const hoText = readFileSync(join(proj, 'HANDOVER.md'), 'utf8');
  c.check('handover 生成六节与接收方验收记录四要素', rHo.status === 0 && hoText.includes('### 接收方验收记录') && hoText.includes('session-b'));

  // 9. INV-18: 空 source 拒绝 --flow 退 1
  writeFileSync(join(proj, 'functions/fn-bad.json'), JSON.stringify({ id: 'fn-bad', title: '编造功能', contracts: ['slot-format'], source: '基于分析得出' }));
  const rBadFlow = runDg(['status', '--flow'], proj);
  c.check('INV-18 转述顶替原话 --flow 拒绝渲染退 1', rBadFlow.status === 1);
  rmSync(join(proj, 'functions/fn-bad.json'));

  // 10. INV-07: 修改源码后状态变「过期」；INV-06: 改判据字符不重签变「无法判断」
  writeFileSync(join(proj, 'src/format/time.mjs'), 'export const fmt = (n) => String(n).padStart(2, "0"); // edited\n');
  const stExpired = dispatchCommand(['status'], proj);
  c.check('INV-07 材料改后状态自动变「过期 1」', stExpired.stdout.includes('过期 1'));

  const cTamper = JSON.parse(readFileSync(cPath, 'utf8'));
  cTamper.obligations[0].claim = '被偷偷改了一个字';
  writeFileSync(cPath, JSON.stringify(cTamper, null, 2));
  const stUnresigned = dispatchCommand(['status'], proj);
  c.check('INV-15 过期状态下改判据未重签 → 未验证 1（而非无法判断）', stUnresigned.stdout.includes('未验证 1'));

  // 11. graph 覆盖率 < 30% 拒出图退 1 (INV-09)
  for (let i = 0; i < 6; i++) writeFileSync(join(proj, `src/orphan${i}.mjs`), `export const x${i} = ${i};\n`);
  const rLowGraph = runDg(['graph'], proj);
  c.check('INV-09 覆盖率 < 30% graph 拒出图退 1', rLowGraph.status === 1);

  // 12. retire 空理由退 1，有理由退 0 且不再进计数
  const rRetireBad = runDg(['retire', 'slot-format', '--reason', ''], proj);
  const rRetireOk = runDg(['retire', 'slot-format', '--reason', '已合并进新模块'], proj);
  const stAfterRetire = dispatchCommand(['status'], proj);
  c.check('retire 空理由退 1，有理由退 0 且退出计数 (本轮 0 项)',
    rRetireBad.status === 1 && rRetireOk.status === 0 && stAfterRetire.stdout.includes('本轮 0 项'));

  // 13. 胶囊 V2 与单卡微门禁内核升级全特性断言（摩擦点 #2/#3/#5/#6/#7/#8/#9/#10）
  const v2Lab = runCapsuleAndStubUpgradeChecks(tmp);
  runMicroGateGitDeltaChecks(v2Lab);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

c.summary('DoneGate 十二条命令与密封胶囊 V2 端到端');
process.exit(c.bad ? 1 : 0);
