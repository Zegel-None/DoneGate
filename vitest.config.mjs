// vitest 配置：导出纯对象，兼容本地 npm test 与免预装 npx vitest run。
// 十二条判据不经过这里——它们是 `node skill/xxx.mjs` 直跑的零依赖脚本。
export default {
  test: {
    include: ['tests/**/*.test.mjs'],
    reporters: ['default'],
    // 含多轮 git/node 子进程的集成用例在 Windows + Defender 扫描下易超过默认 5000ms
    testTimeout: 30000,
  },
};
