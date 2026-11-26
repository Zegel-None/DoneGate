// L4 工作台确定性本地实时同步端口映射原语（SHA-256 映射至安全高位区间 [41200, 48200)）
import { resolve } from 'node:path';
import { sha256 } from '../../skill/hash.mjs';

export function computeLivePort(projectRoot) {
  const hex = sha256(resolve(projectRoot)).slice(0, 4);
  return 41200 + (parseInt(hex, 16) % 7000);
}
