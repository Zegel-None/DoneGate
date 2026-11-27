// 变焦驾驶舱索引门面（按适配器分派通用仓库索引或 DoneGate 宿主治理索引，L5 donegate-cli）
import { DONEGATE_COCKPIT_ADAPTER } from './adapters/donegate-adapter.mjs';
import {
  createGenericCockpitAdapter,
  extractFullHeaderComment,
  GENERIC_COCKPIT_ADAPTER,
  kneedleElbowCount
} from './adapter-protocol.mjs';

export { createGenericCockpitAdapter, extractFullHeaderComment, GENERIC_COCKPIT_ADAPTER, kneedleElbowCount };

export function resolveCockpitAdapter(adapterOpt) {
  if (!adapterOpt || adapterOpt === 'donegate') return DONEGATE_COCKPIT_ADAPTER;
  if (adapterOpt === 'generic') return GENERIC_COCKPIT_ADAPTER;
  if (typeof adapterOpt === 'object' && typeof adapterOpt.buildIndex === 'function') return adapterOpt;
  return DONEGATE_COCKPIT_ADAPTER;
}

export function buildCockpitGraphIndex(projectRoot, opts = {}) {
  const adapter = resolveCockpitAdapter(opts.adapter);
  return adapter.buildIndex(projectRoot);
}
