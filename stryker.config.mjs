// Stryker 配置：把「判据有没有牙」从人工改坏变成机器读数（对应 02-规格 §六 的档 B）。
//
// 靶标：skill/hash.mjs（纯函数哈希与材料指纹内核，已实现 60/60 = 100% 变异杀死率，break 锁死 100）。
export default {
  mutate: ['skill/hash.mjs'],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mjs' },
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  thresholds: { high: 100, low: 100, break: 100 },
  timeoutMS: 20000,
  concurrency: 4,
};
