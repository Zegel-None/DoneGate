// 夹具用的断言助手（唯一实现）。合并自早年多份夹具里的重复断言计数器，
// 由 skill/check-symbols.mjs 的「同体不同名」克隆检测门禁统一收口。
// 三份的差异只有打印符号与计数器名字——这正是「样板可以重复、口径不行」里最该合并的那一类。
//
// 用法：
//   const c = createChecks();
//   c.ok('某条断言', cond, '失败时附带的细节');
//   ...
//   if (c.bad) { process.exit(1); }
export const createChecks = (mark = { ok: '✓', bad: '✗' }) => {
  let bad = 0;
  return {
    check(name, cond, extra = '') {
      if (cond) console.log('  ' + mark.ok + ' ' + name);
      else { bad++; console.log('  ' + mark.bad + ' ' + name + (extra ? '  → ' + extra : '')); }
      return !!cond;
    },
    /** 兼容旧名字：三份夹具里有两份叫 check、一份叫 ok */
    ok(name, cond, extra = '') { return this.check(name, cond, extra); },
    get bad() { return bad; },
    summary(label = '结果') {
      console.log('\n' + label + '：' + (bad === 0 ? '全过' : bad + ' 条不成立'));
      return bad;
    }
  };
};
