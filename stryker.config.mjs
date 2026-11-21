// Stryker 配置：把「判据有没有牙」从人工改坏变成机器读数（对应 02-规格 §六 的档 B）。
//
// 只变异一个靶子（skill/hash.mjs）作为试点：它是纯函数内核、无副作用、最容易被吃透。
// 靶子扩大时改 `mutate` 数组即可，不要一上来全仓库变异（慢且噪声大）。
//
// 跑法：npx stryker run
// 产物：reports/mutation/mutation.json（机器读）+ 控制台 clear-text（人读）
// 退出码：mutation score 低于 thresholds.high 时非零——**这正是我们要的「失败要响」**。
export default {
  mutate: ['skill/hash.mjs'],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mjs' },
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  thresholds: { high: 90, low: 70, break: 70 },
  timeoutMS: 20000,
  concurrency: 4,
};
