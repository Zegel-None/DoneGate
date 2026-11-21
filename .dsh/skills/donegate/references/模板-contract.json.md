# 模板 · contract.json

`contracts/<id>/contract.json` 是契约的唯一载体：几行给人看的说明，加一组能被机器跑的判据。字段定义在 §2.3（调研/评审材料，不在公开分发包内）、判据字段在 §2.4（调研/评审材料，不在公开分发包内）、三个新增字段的取值在 §15.2（调研/评审材料，不在公开分发包内）。本卡不重抄这些表，只写怎么落笔、按什么顺序、什么算过。

## 入口条件

- 意图已定稿，成功条件能逐字引用——`servesSuccessCriterion` 只能抄原文（§15.2）。
- 本契约拥有的代码能用一个路径或路径前缀说清。说不清就是边界还没划出来，先别动笔。
- 至少有一条判据能写成「单条命令 + 可读的退出码四值（0 / 1 / 2 / 3）」。写不出命令就先写 `kind: human`，不许拿一句口号占位。
- 目录 `contracts/<id>/` 已建，`<id>` 稳定小写、与目录名一致（§2.3）。

## 步骤

1. 先落身份四栏：`id`、`title`、`why`、`owner`。`why` 控制在三行以内，写不下说明该拆（§2.3）。
2. 划 `scope`：只写本契约拥有的路径或前缀。与别人共用一个文件就填 `overlapsWith`，并约定同轮改、同轮判（§2.3）。
3. 写 `obligations`，每条先过一遍判据三件套：claim 主张什么、observable 看什么、scope 在哪看，三者对不上就删掉重写（§四（调研/评审材料，不在公开分发包内），定义在 §6.1）。三件套就写在 obligation 上；`assertionId` **不另开字段**，它就是本条义务的 `id`（G-01）。
4. `kind` 只选 `command` 或 `human`。选 `command` 时 `command` 一栏只放一条命令，不串联、不把输出落到文件；`expect` 填 `exitCode` 与可选的 `stdoutMatches`（§2.4），**`stdoutMatches` 是精确匹配**：把实测 stdout 去掉行尾空白/换行后与它**整串相等**才算命中，**它不是正则**——写 `["a","b"]` 就要求输出就是那五个字符（G-11）。选 `human` 时 `expect` 用 `{ "standard": "一句判断标准" }`，**与 `exitCode` 互斥**（G-06）。
5. 补三个字段：`inputClasses` 至少一项，取值在 `正常` / `边界` / `异常` 里选，**三类要在本契约里各有至少一条判据**（一条判据只填一类是正常写法）；`spansContracts` 只在跨契约判据上填 ≥2 个契约；`servesSuccessCriterion` 抄意图原文（§15.2）。
6. 冻结：按**固定算法**重算 `frozenHash`，再让 `signedBy` 填上人。空着就是没冻结，门 2 不过（§15.1 2.2）。算法逐字如下，**不许自己发明**（G-09 实测：只写「按内容重算」时四个人会写出三种算法）：
   ① 复制该条判据，去掉 `frozenHash`、`teeth`、`signedBy` **三个字段**（签名不算「判据内容」；`scopeAck` 要留，见第 8 步）；
   ② 剩下的对象**键名递归按字典序排序**（数组保持原序），`JSON.stringify` 成**紧凑**字符串（不缩进、无空格）；
   ③ 对该字符串的 UTF-8 字节取 SHA-256，**小写十六进制**——这个值就是 `frozenHash`。
   先取 `scopeAck` 再算哈希、再填 `signedBy`；改任何一个字段都要重算重签。
7. `provisional` 新建填 `true`；`dependsOn` 只写契约标识（§2.3）。
8. 每条判据再加 `scopeAck: { "by": "<确认人>", "at": "<YYYY-MM-DD>" }`：**`by` 不许是写方自己**，由裁方逐条确认「不覆盖什么，我认」后填（G-10，门 2 出口 8）。
9. 照下面这份示例改，别另起格式。

```json
{
  "id": "booking-create",
  "title": "任意时段的订房写入",
  "why": "下单是整条业务链的入口，写错一间房会让后面所有环节重算。",
  "scope": ["src/booking/create/", "src/booking/shared/"],
  "owner": "预订组",
  "dependsOn": ["booking-hold"],
  "provisional": true,
  "overlapsWith": ["booking-hold"],
  "obligations": [
    {
      "id": "create-writes-one-booking",
      "kind": "command",
      "command": "node scripts/booking-create.test.mjs",
      "expect": { "exitCode": 0 },
      "frozenHash": "<按判据内容重算后填入>",
      "signedBy": "业主",
      "required": true,
      "claim": "提交一次合法预约，库里恰好新增一条，且金额等于该套餐价",
      "observable": "booking-count 由 0 变 1；total === 123400（分）",
      "scope": "不覆盖并发重复提交、不覆盖优惠券",
      "scopeAck": { "by": "业主", "at": "2026-11-19" },
      "inputClasses": ["正常", "边界"],
      "servesSuccessCriterion": "客人能在跨零点的时段订到一间房"
    },
    {
      "id": "create-hold-cross",
      "kind": "command",
      "command": "node scripts/booking-cross.test.mjs",
      "expect": { "exitCode": 0, "stdoutMatches": "hold-then-create" },
      "frozenHash": "<按判据内容重算后填入>",
      "signedBy": "业主",
      "required": true,
      "claim": "跨零点时段下单时，先占位再落单，顺序不能反",
      "observable": "stdout 整串等于 hold-then-create（顺序断言落在输出上；精确匹配，不是正则，G-11）",
      "scope": "不覆盖占位超时、不覆盖跨契约回滚",
      "inputClasses": ["异常"],
      "spansContracts": ["booking-create", "booking-hold"],
      "servesSuccessCriterion": "客人能在跨零点的时段订到一间房"
    }
  ]
}
```

示例没写 `teeth`：没做过有牙实验就没有这一栏，做法见 [门3-有牙.md](./门3-有牙.md)；**有牙实验的改坏档是 §六 的 A / B / C（默认 A），不是 §九 的项目成熟档 T0 / T1 / T2**，别传错。若使用 `runner` 的 `teeth`（档 A），需在冻结前于判据下填好 `breakPatch: { "file": "...", "from": "...", "to": "..." }`。

| 字段 | 落笔动作 | 出处 |
|---|---|---|
| `id` / `title` / `owner` | 抄目录名、一句业务话、人或角色 | §2.3 |
| `why` | 三行以内 | §2.3 |
| `scope` / `overlapsWith` | 拥有的路径；共享文件写进 `overlapsWith` | §2.3 |
| `dependsOn` / `provisional` | 只写契约标识；新建填 `true` | §2.3 |
| `kind` / `command` / `expect` | 两种 kind；单条命令；退出码加可选 stdout | §2.4 |
| `frozenHash` / `signedBy` | 若用 CLI `contract freeze` 会自动重算并填入 `frozenHash`（手填/纯技能版才按 §2.4 归一化重算）；签过才算冻结 | §2.4、§15.1 2.2 |
| `required` | 填真或假，默认真 | §2.4 |
| `inputClasses` | 至少一项，且**本条判据**至少含一个非正常类 | §15.2 |
| `spansContracts` | 只有跨契约判据填；列出 ≥2 个契约标识 | §15.2 |
| `servesSuccessCriterion` | 抄意图里那条成功条件的**原文第一句** | §15.2 |

`functions/<id>.json` 的字段在 §2.3.1，是另一个文件，不进本卡。

## 出口判据

1. 用任意 JSON 解析器读一遍该文件：解析报错，或 `id` 与所在目录名不是逐字相同，即判不过（§2.3）。
2. 数 `obligations`：少于一条，或没有一条 `kind` 为 `command`，即判不过（§15.1 2.1、2.3）。
3. `inputClasses` 分两层看：**逐条**——任一条判据缺这一栏即判不过；**契约层**——把全部判据的类别取并集，`正常` / `边界` / `异常` 缺任何一类即判不过（§15.1 2.4 判的是契约三类齐；**单条判据只填 `正常` 是对的**）。这一条只判「声明了」，不判「真的测了」。
4. 项目有两个以上契约时看 `spansContracts`：没有一条判据列出 ≥2 个契约标识，即判不过（§15.1 2.6）。
5. **两个方向都要查（§15.1 2.7 要求的是「意图里每条成功条件都挂上至少 1 条判据」）**：① 逐条把 `servesSuccessCriterion` 拿到意图里逐字搜，有一条搜不到即判不过；② 反过来遍历意图里的每条成功条件，有哪一条没有任何判据指向它，同样判不过。
6. 挑一条 `command` 判据做一次有牙实验：**按 §六 改坏实现（不是改 `expect`）**，跑判据看它红不红——不红即「无牙」，判不过。改 `expect` 会让 `frozenHash` 与内容不一致，那是另一种错误，验不出判据有没有牙。

## 业界做法参考

| 参考条目 | 它做到哪一步 | 本卡与它的差异 |
|---|---|---|
| C1 首选 · dependency-cruiser | 把边界写成 `forbidden` 规则，逐条比对 from / to 路径，命中以非零退出码结束 | 本卡不建依赖图：`scope` 只作声明，越界由门 5 的 V1 按 `base..head` 的 diff 判（门 2 不再判越界，原 2.3 已删） |
| C1 备选 · eslint-plugin-import `no-internal-modules` | 用 allow / forbid 让深路径 import 直接报错 | 本卡不把边界写进 lint 配置，边界只出现在 contract.json 一处 |
| C1 备选 · Import Linter `protected` | 要求同时声明受保护模块与允许的引用方，逐条 import 核对 | 本卡只要 `scope` 与 `overlapsWith` 两栏，引用关系由 `spansContracts` 声明 |

**差异与两个代价**：一次边界调整会带出两类越界——判据 scope 跑到契约 scope 外、绕过公开入口直连内部文件。现成做法把 `scope` 展开成两条 from / to 规则并同轮改，两类都能报；本卡只维护两栏声明，代价是第二类永远不报，得靠人另加判据补。口径见 ADR-015（调研/评审材料，不在公开分发包内）。

## 延伸阅读

- §2.3 契约字段（调研/评审材料，不在公开分发包内）、§2.4 判据字段总表（调研/评审材料，不在公开分发包内）、§15.2 三个新增字段（调研/评审材料，不在公开分发包内）
- §15.1 门 2 的九条条件（调研/评审材料，不在公开分发包内）：本卡步骤与出口判据覆盖其中 2.1、2.2、2.3、2.4、2.6、2.7
- §6.1 判据三件套（调研/评审材料，不在公开分发包内）、§九 档位（调研/评审材料，不在公开分发包内）、§八 退出码四值（调研/评审材料，不在公开分发包内）
- [门2-判据.md](./门2-判据.md)：判据写完后怎么交给门 2；[模板-INTENT.md](./模板-INTENT.md)：`servesSuccessCriterion` 的原文出处
