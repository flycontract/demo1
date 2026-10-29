# COMP7610 航班保险 DApp：队友报告与视频接手说明

截至 2026-10-30 香港时间，交付分支是 `icn`。项目仅为 Sepolia 教学原型，FDT 无现金价值。先读[阶段三B真实结算报告](phase3b-real-settlement-2026-10-30.md)、[已接受教学条款](teaching-terms-v1-2026-10-26.md)、[阶段三A部署验收](phase3a-acceptance-2026-10-26.md)，再写报告或剪视频。桌面交接文件夹另含源码压缩包、官网原文、截图和测试日志；其中的 `README.md` 给出每项材料的位置与校验值。

## 1. 可以直接写进报告的事实

| 环节 | 已核对结果 | 一手材料 |
|---|---|---|
| 教学条款 | 保费 10 FDT；官方 At gate 相对事前冻结的计划到达晚至少 7200 秒或明确 Cancelled 赔 100 FDT；未知等待；七天无最终结果退 10 FDT | [条款](teaching-terms-v1-2026-10-26.md) |
| 计划 | SQ898，SIN → HKG，2026-10-29 18:55 SGT 起飞、22:45 HKT 计划抵达；原始官方证据在登记前保存 | [候选与来源](phase3-sq898-candidate-2026-10-29.md)、[冻结输入](evidence/sq898-plan-input-2026-10-29.txt)、桌面官网原文 |
| 部署及登记 | Sepolia `11155111`；DemoToken `0x350B48d0BB1f44764b04155AC2E4970A339f66b7`；保险 `0x0E8A379CA510aae2580a15A22F0A97BBF370da73`；保险部署块 `11999004`；SQ898 为航班 1 | [部署回执](../deployments/sepolia.json)、[登记回执](../deployments/flight-sq898-2026-10-29.json) |
| 事前投保 | 买家 `0x9208707E8d967365901b54249D335CAc5B10829c` 只授权 10 FDT；保单 0 在 27 日 00:17:48 HKT 买入，比 28 日 18:55 HKT 截止早 153432 秒 | [授权](https://sepolia.etherscan.io/tx/0xc4030032172a9a765d4258eaa219abd12f24cf14551e60d09a2c33d8fc5464ee)、[购买](https://sepolia.etherscan.io/tx/0x94d9f9ac3c45c5c6ade5ebd11125fa3f8ce622fc46e289addea50f3c4f56839b)、[购买证据](evidence/sq898-purchase-chain-evidence-2026-10-27.json) |
| 事后真实核验 | 30 日 03:00:24 HKT 发出核验请求；HKIA 历史原文唯一匹配 SQ898/SIN，`At gate 22:49`；晚 240 秒，低于 7200 秒门槛 | [请求](https://sepolia.etherscan.io/tx/0x516d6204a1f866f0b8bebdd7f942411b01a5dc2e15410cfbfed5941156b58adc)、[机场原始响应](evidence/sq898-hkia-history-2026-10-29.raw.json)、[机器证据](evidence/sq898-real-settlement-2026-10-30.json) |
| 结算 | 预言机 03:01:36 HKT 回调；保单 0 `ClosedNoPay`，支付 0；买家 190 FDT 不变，池 10010 FDT 不变，预留 100 → 0 FDT | [回调](https://sepolia.etherscan.io/tx/0x8d008219af542b2bb89d64f2013793104d3116adff08f00f745423917f988292)、[结算报告](phase3b-real-settlement-2026-10-30.md) |

**不要写成事实：**这趟真实航班发生了两小时延误、赔了 100 FDT、触发七天退款，或浏览器错链防护已经通过。100 FDT 赔付、取消和退款是独立的本地 31337 测试。哈希只能核对保存的字节，不能证明机场发布内容永远正确。真实结算是一次性的，官网日后更正不能撤销链上结果。

## 2. 新机器复现代码与测试

用 Node 22、Python 3.11、Git；在新目录运行以下 PowerShell 命令，不复制原工作站的 `.env`、私钥、数据库、`node_modules`、`artifacts`、`dist` 或虚拟环境。先记 `git rev-parse HEAD` 和机器/系统版本，再记每条命令的退出码。首次编译可能下载 solc 0.8.24。

```powershell
git clone --branch icn https://github.com/flycontract/demo1.git demo1-team-check
Set-Location demo1-team-check
node --version
npm --version
py -3.11 --version
git rev-parse HEAD
npm ci
npm --prefix oracle ci
npm --prefix frontend ci
py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r test_python\requirements.txt
npm run compile
npm run abi:check
.venv\Scripts\python.exe test_python\run_tests.py
npm --prefix oracle run build
npm --prefix oracle test
npm --prefix frontend run build
npm run local:e2e
npm run secret:scan
git status --short
```

预期本地 `local:e2e` 在隔离的 **31337** 链结束为池 **9840 FDT**、预留 **0 FDT**；这不是 Sepolia 余额。若队友只有桌面源码 zip，可先解压阅读和本地测试，但 zip 没有 Git 历史，正式复现建议从 `icn` clone。当前机器的旧干净克隆只证明同机新目录复现，不能写成“另一台电脑已验证”。新 clone 无私有 `.env`，不要运行 `env:check deployed` 或部署脚本来凑通过项；链上结果用公开回执和只读浏览器核对。

桌面交接包 `test-logs/` 还包含 30 October 当前工作区重跑的完整命令日志与 `phase4-current-checkout-summary-2026-10-30.md`：合约 31/31、oracle 19/19、ABI/构建、31337 E2E、秘密扫描和部署只读检查均通过。合约日志末尾有 py-solc-x 文件句柄的 `ResourceWarning`，测试退出码仍为 0；报告需按原样说明。该批日志同样不是另一台机器的复现。

## 3. 报告写作顺序

1. **目标和信任模型：**解释保险方登记、买家投保、单一 oracle、香港机场历史源、合约结算；引用桌面交接包 `brief/PRD.md`、仓库 README 与条款。说明这是课程测试网原型。
2. **协议和实现：**写 24 小时截止、一次投保、资金池/赔付预留、At gate 秒级阈值、取消与未知、七天退款；指出智能合约、前端、oracle/SQLite 的职责边界。
3. **可复现实验：**用本地合约 31/31、oracle 19/19、ABI/构建、隔离 E2E 和秘密扫描日志；注明旧日志对应的 SHA/同机环境，补上队友新机器的实际版本与退出码。
4. **真实 SQ898 时间线：**按计划原文和哈希 → 登记回执 → 10 FDT 授权/事前购买 → 30 日核验请求 → HKIA 原始 90,789 字节及唯一匹配 → 预言机回调 → ClosedNoPay 和余额/预留，引用上表一手材料。
5. **局限与结论：**单一签名 oracle 和可更正数据源、一次最终结算、原计划证据可靠性、浏览器错链/切账户验收未通过、尚无连续录屏；将本地赔付/退款模拟与真实不赔闭环分开。

报告中不能只引用截图或一个哈希就断言真实数据正确。最好并列展示官网原文、抓取时间、哈希、链上回执及解释；原始资料可随交接包保存，正文只摘取必要字段。

## 4. 视频录制脚本（建议 5–8 分钟）

1. 镜头开头显示 `icn` 固定 SHA、课程教学原型声明、条款与两小时阈值。不要展示任何 `.env`、密钥、钱包密码或助记词。
2. 展示两份官方事前计划材料及冻结哈希，接着展示链上航班 1 登记与 24 小时截止；用投保前和 Active 截图辅助说明。
3. 展示准确 10 FDT 授权、购买区块时间、买家 200 → 190、池 10000 → 10010、预留 0 → 100。
4. 展示请求交易、机场历史原文中的 `SQ 898 / SIN / At gate 22:49`、SHA-256/keccak256、oracle 回调及最终页面 `ClosedNoPay`；说明 22:49 − 22:45 = 240 秒 < 7200 秒，支付 0、预留降到 0。
5. 如演示赔付、取消或退款，标题和口播都标成“本地 31337 合成用例”；最后披露单源/单 oracle、数据更正和浏览器验收缺口。

桌面 `screenshots/` 已有投保前、购买确认、Active、Verifying 的静态截图，**没有**事前至事后连续录屏，也未归档最终 ClosedNoPay 页面截图。录制者可在本机用 `npm --prefix frontend run dev -- --host 127.0.0.1` 启动已配置的原工作区并展示最终只读状态；若需要连接原买家钱包，必须由钱包主人亲自解锁和批准，不能索要或复制其私钥。队友在自己的新 clone 上可改用 Etherscan 回执和交接截图，不要冒称现场钱包操作。不要为了录屏重复购买、重复核验或向 Sepolia 注入模拟回调。

## 5. 合并前检查

最终课程截止按现有资料为 **2026-11-08**，具体提交格式与时间仍以最新课程平台通知为准。队友完成报告/视频后，在独立 checkout `git fetch origin`，比较 `origin/main...origin/icn` 与 merge base，审核公开证据、依赖告警和遗漏测试。`main` 当前仍是初始提交的祖先；远端 `🌰` 分支的主要运行修复已由 `icn` 以不同实现覆盖，不能不审查就整支合并。**只有项目所有者最终同意发布并审阅合并结果后**才走普通 PR/快进，不强推、不提交 `.env`。交接包本身不授权任何新链上交易。
