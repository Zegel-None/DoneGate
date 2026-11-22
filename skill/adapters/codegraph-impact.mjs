// 适配器 · codegraph 影响面与循环依赖观测（Adapter Protocol v1.1 · 委托 _shared.mjs）
import { runAdapter } from './_shared.mjs';

runAdapter({
  tool: 'codegraph',
  defaultRole: 'hard',
  requireRegistryId: true,
  enforceTestedRange: true,
  degradedTo: '人工按同一格式手写受影响文件清单与静态循环引用核查记录',
  collect(ctx) {
    const rawCycles = ctx.readRawOverride('--raw-cycles');
    const rawImpact = ctx.readRawOverride('--raw-impact');
    if (rawCycles === null && rawImpact === null) {
      const stR = ctx.runBin(['status', '--json', ctx.rootDir]);
      if (stR.status !== 0) ctx.fail(3, 'codegraph status 失败：' + (stR.stderr || stR.stdout));
      const stJson = ctx.parseJsonOrFail(stR.stdout, 'codegraph status');
      if (!stJson || !stJson.initialized || !stJson.index || stJson.index.state !== 'complete') {
        ctx.fail(3, 'codegraph 索引未初始化或未完成，请先运行 codegraph init 并执行 codegraph sync');
      }
      const pc = stJson.pendingChanges || {};
      if ((pc.added || 0) + (pc.modified || 0) + (pc.removed || 0) > 0 || (stJson.index.filesNeedingReindex || 0) > 0) {
        ctx.fail(3, 'codegraph 索引已过期，请先运行 codegraph sync / index');
      }
    }
    let cyclesText = rawCycles;
    if (cyclesText === null) {
      const cyR = ctx.runBin(['cycles', '--json', ctx.rootDir]);
      if (cyR.error || (cyR.status !== 0 && cyR.status !== 1)) ctx.fail(3, 'codegraph cycles 执行失败：' + (cyR.stderr || cyR.error?.message));
      cyclesText = cyR.stdout || '';
    }
    const cyclesJson = ctx.parseJsonOrFail(cyclesText, 'codegraph cycles');
    if (!cyclesJson || typeof cyclesJson.count !== 'number' || !Array.isArray(cyclesJson.cycles)) {
      ctx.fail(3, 'codegraph cycles 输出缺少必填字段 count 或 cycles');
    }
    const changedFiles = (ctx.arg('--changed', '') || '').split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
    const inputs = ctx.hashInputFiles(ctx.rootDir, changedFiles, '变更输入文件');
    const impactedSet = new Set(), rawImpacts = [];
    if (rawImpact !== null) {
      const impJson = ctx.parseJsonOrFail(rawImpact, 'codegraph impact');
      if (!impJson || !Array.isArray(impJson.affected)) ctx.fail(3, 'codegraph impact 输出缺少必填字段 affected');
      rawImpacts.push(impJson);
      for (const n of impJson.affected) if (n && typeof n.filePath === 'string') impactedSet.add(n.filePath.replace(/\\/g, '/'));
    } else {
      for (const fp of changedFiles) {
        const nodeR = ctx.runBin(['node', '-p', ctx.rootDir, '-f', fp, '--symbols-only']);
        if (nodeR.status !== 0) ctx.fail(3, `codegraph node 失败 (${fp})：${nodeR.stderr || nodeR.stdout}`);
        const nodeOut = nodeR.stdout || '';
        const usedLine = nodeOut.match(/used by \d+ files?:\s*([^\r\n]+)/i);
        if (usedLine) {
          for (const dep of usedLine[1].split(',').map((s) => s.trim().replace(/\\/g, '/')).filter((s) => s && !/^\+\d+\s+more$/i.test(s))) impactedSet.add(dep);
        }
        for (const m of nodeOut.matchAll(/^- `([^`]+)`/gm)) {
          const impR = ctx.runBin(['impact', '-p', ctx.rootDir, '-f', fp, '-d', '5', '--json', m[1]]);
          if (impR.status !== 0) ctx.fail(3, `codegraph impact 失败 (${fp}#${m[1]})：${impR.stderr || impR.stdout}`);
          const impJson = ctx.parseJsonOrFail(impR.stdout || '', 'codegraph impact');
          if (!impJson || !Array.isArray(impJson.affected)) ctx.fail(3, 'codegraph impact 输出缺少必填字段 affected');
          rawImpacts.push({ file: fp, symbol: m[1], affected: impJson.affected });
          for (const n of impJson.affected) if (n && typeof n.filePath === 'string') impactedSet.add(n.filePath.replace(/\\/g, '/'));
        }
      }
    }
    for (const fp of changedFiles) impactedSet.delete(fp);
    const impactedFiles = [...impactedSet].sort();
    const observation = { changedFiles, impactedFiles, cycleCount: cyclesJson.count, cycles: cyclesJson.cycles };
    return {
      rawFileName: 'raw-impact.json',
      rawKind: 'codegraph-impact-raw',
      rawJson: { cycles: cyclesJson, impacts: rawImpacts },
      inputs,
      observation,
      claims: [
        { text: `变更 ${changedFiles.join(', ') || '(none)'} 影响 ${impactedFiles.length} 个下游文件，明细见 ${ctx.obsRelPath}`, checkedBy: ctx.entry.checkedBy[0] },
        { text: `全仓检出 ${cyclesJson.count} 条循环依赖环路，明细见 ${ctx.obsRelPath}`, checkedBy: ctx.entry.checkedBy[1] }
      ],
      summaryLog: `impacted=${impactedFiles.length}, cycles=${cyclesJson.count}`
    };
  }
});
