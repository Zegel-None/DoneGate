// 工作台主体 DOM 骨架分片 B（零外网依赖单文件工作台分片模块，严格 <= 300 行）
export function buildWbDomB() {
  return [
  "        <button type=\"button\" class=\"atlas-tab-btn\" data-ov-tab=\"arch\" onclick=\"switchAtlasOvTab('arch')\">2. 功能怎么串起来的</button>",
  "        <button type=\"button\" class=\"atlas-tab-btn\" data-ov-tab=\"branches\" onclick=\"switchAtlasOvTab('branches')\">3. 支线进度与撞车提醒</button>",
  "        <button type=\"button\" class=\"atlas-tab-btn\" data-ov-tab=\"ledger\" onclick=\"switchAtlasOvTab('ledger')\">4. 验收体检单</button>",
  "      </div>",
  "      <div id=\"atlas-ov-body\" class=\"flex-1 overflow-y-auto flex flex-col gap-2.5 text-xs pr-0.5\"></div>",
  "    </div>",
  "  </div>"
  ].join('\n');
}
