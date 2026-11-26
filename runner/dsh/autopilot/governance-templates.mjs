// 个人常用治理模板管理（一键存为跨项目模板，新项目复用微调差异且自动继承最新官方默认流，<= 125 行）
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readJsonStrict } from '../../../skill/io.mjs';
import { GOVERNANCE_OVERRIDES_REL } from '../../core/contract.mjs';
import { wfcAssertHumanAuthority, wfcSaveProjectOverlay } from './workflow-compiler.mjs';

export function gtResolveTemplatesDir(opts = {}) {
  if (typeof opts.templatesDir === 'string' && opts.templatesDir.trim()) {
    return resolve(opts.templatesDir.trim());
  }
  return join(homedir(), '.donegate', 'templates');
}

function gtSafeTemplateId(rawName) {
  const clean = String(rawName || 'my-default')
    .trim()
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 48);
  return clean || 'my-default';
}

export function gtSavePersonalTemplate(projectRoot, templateName, opts = {}) {
  const role = String(opts.actorRole || 'human').trim().toLowerCase();
  if (['worker', 'executor', 'coder', 'subagent'].includes(role)) {
    return { ok: false, exitCode: 2, code: 'WORKER_CANNOT_MUTATE_GOVERNANCE', reason: '权限拦截：执行端 Worker 禁止保存个人治理模板' };
  }
  const root = resolve(projectRoot);
  const ovDir = join(root, GOVERNANCE_OVERRIDES_REL);
  const overlays = {};
  if (existsSync(ovDir)) {
    for (const name of readdirSync(ovDir).sort()) {
      if (!name.endsWith('.overlay.json')) continue;
      const r = readJsonStrict(join(ovDir, name));
      if (!r.ok || !r.value) continue;
      const fid = String(r.value.flowId || name.replace(/\.overlay\.json$/, ''));
      overlays[fid] = {
        toggleNodes: r.value.toggleNodes || {},
        patchConfig: r.value.patchConfig || {},
        swapBrick: r.value.swapBrick || {},
        insertNodes: r.value.insertNodes || [],
        patchLinks: r.value.patchLinks || []
      };
    }
  }
  const tplId = gtSafeTemplateId(templateName);
  const tplDir = gtResolveTemplatesDir(opts);
  mkdirSync(tplDir, { recursive: true });
  const doc = {
    schema: 'donegate-governance-template/v1',
    id: tplId,
    name: String(templateName || tplId).trim(),
    description: String(opts.description || '从已调顺手的项目沉淀的个人治理规则微调模板').slice(0, 180),
    savedAt: new Date().toISOString(),
    flowIds: Object.keys(overlays),
    overlays
  };
  const tplPath = join(tplDir, `${tplId}.template.json`);
  writeFileSync(tplPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return { ok: true, exitCode: 0, template: doc, path: tplPath };
}

export function gtListPersonalTemplates(opts = {}) {
  const tplDir = gtResolveTemplatesDir(opts);
  if (!existsSync(tplDir)) return [];
  const items = [];
  for (const name of readdirSync(tplDir).sort()) {
    if (!name.endsWith('.template.json')) continue;
    const r = readJsonStrict(join(tplDir, name));
    if (r.ok && r.value && r.value.id) {
      items.push({
        id: r.value.id,
        name: r.value.name || r.value.id,
        description: r.value.description || '',
        savedAt: r.value.savedAt || '',
        flowIds: Array.isArray(r.value.flowIds) ? r.value.flowIds : Object.keys(r.value.overlays || {})
      });
    }
  }
  return items;
}

export function gtApplyPersonalTemplate(projectRoot, templateNameOrId, opts = {}) {
  const auth = wfcAssertHumanAuthority(opts.actorRole, opts.confirmedByHuman);
  if (!auth.ok) return auth;
  const tplId = gtSafeTemplateId(templateNameOrId);
  const tplPath = join(gtResolveTemplatesDir(opts), `${tplId}.template.json`);
  if (!existsSync(tplPath)) {
    return { ok: false, exitCode: 3, code: 'TEMPLATE_NOT_FOUND', reason: `找不到个人常用模板：${tplId}` };
  }
  const r = readJsonStrict(tplPath);
  if (!r.ok || !r.value || typeof r.value.overlays !== 'object') {
    return { ok: false, exitCode: 2, code: 'TEMPLATE_CORRUPT', reason: '个人模板文件已损坏' };
  }
  const applied = [];
  for (const [flowId, patch] of Object.entries(r.value.overlays)) {
    const res = wfcSaveProjectOverlay(projectRoot, flowId, patch, { actorRole: 'human', confirmedByHuman: true });
    if (res.ok) applied.push({ flowId, workflowHash: res.workflowHash, disabledIntegrityCount: res.disabledIntegrityRules.length });
  }
  return { ok: true, exitCode: 0, templateId: tplId, appliedCount: applied.length, applied };
}
