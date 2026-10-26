# COMP7610 阶段二验收（2026-10-26）

## 结论

阶段二的**本地代码、隔离 E2E 与环境准备验收通过**。验收时工作树在 `codex/mvp-ready`；后续提交状态以 Git 为准。无 Sepolia 部署、广播交易、真实投保或浏览器钱包联调。At gate 为**待用户确认的教学条款建议**；前端 `VITE_SALES_ENABLED=false`，真实销售不开放。

## 已完成与验收证据

| 项目 | 本轮结果 | 证据 |
|---|---|---|
| 合约 | 独立计划起飞/到达；起飞前 24h 等号可买；秒差 7200；七天严格回调/等号退款；别名去重；计划证据冻结；31/31 通过 | `evidence/phase2-contract-tests-final.log` |
| ABI | 编译产物生成前端和预言机 ABI，`compile`、`abi:check` 退出码 0 | `scripts/sync-abi.mjs` 与生成文件 |
| 预言机 | 目标日期、跨日/代码共享/取消/歧义；HK 自然日刷新间隔与策略上限；原始字节证据先存；确认块分段重扫、DB 作用域、重启恢复；15/15 通过，TS build 通过 | `evidence/phase2-oracle-tests.log`、`oracle/src/reliability.test.ts` |
| 前端 | 持续读取链时间；读链失败禁时间动作；钱包错链/换账户禁写并交易前重验；HKT 各截止点、交易 pending/链接、结果及证据哈希；生产 build 通过 | `frontend/src/` |
| 本地 E2E | 独立 31337/临时 SQLite；真实历史响应离线回放 + 明确模拟；准确余额、预留、证据、回执、无权限、重启去重；退出码 0 | `evidence/phase2-local-e2e.log` |
| 环境 | 三份实际 .env 已创建且 Git 忽略；独立专用账户；RPC `eth_chainId=11155111`；`env:check prepare` 通过 | 下表与 `scripts/env-check.mjs` |

E2E 初始池 10000、五份保费后 10050、两份 100 赔付和一份 10 退款后 **9840 FDT**，预留由 500 归零。历史 CX 636 在 2026-10-25 官方响应中显示 At gate 00:02；本地注册的 00:10 **仅为演示计划假设**，不是证实的原计划。模拟覆盖延误、准点、取消、未知超时；真实样本和模拟不可互换。

最终命令均在 Node 22.23.2 下执行：`npm run compile`、`npm run abi:check`、`python test_python/run_tests.py`、`npm --prefix oracle run build`、`npm --prefix oracle test`、`npm --prefix frontend run build`、`npm run local:e2e`、`npm run env:check -- prepare`、`npm run secret:scan` **退出码均为 0**。相应日志在 `evidence/phase2-builds.log`、`phase2-contract-tests-final.log`、`phase2-oracle-tests.log`、`phase2-frontend-build.log`、`phase2-local-e2e.log`、`phase2-env-prepare-check.log`、`phase2-secret-scan.log`。Python `solcx` 退出时有未关闭锁文件的 ResourceWarning，测试结果不受影响。`env:check deployed` **退出码 1（预期）**，准确报告两个合约地址、oracle 合约地址和部署区块尚未填写。`git diff --check` 退出码 0；仅有 Git 的 LF/CRLF 转换提示。

## 脱敏 env 状态

| 文件 | 已验证 | 待部署/未接通 |
|---|---|---|
| 根 `.env` | Sepolia 公开 RPC；独立保险方私钥本地保存；仅公开地址 `0xDc376E51a2845A1FFac0A71952dAFd30f1d7F53a`；oracle 公开地址匹配 | 无 Sepolia ETH、未部署 |
| `oracle/.env` | 独立预言机私钥本地保存；公开地址 `0x3C65B6280BeCCdb01857B53579407Bf026B1F939`；独立 Sepolia DB 路径和运行参数 | `CONTRACT_ADDRESS=UNDEPLOYED`、`DEPLOY_BLOCK=UNDEPLOYED`；未持续启动 |
| `frontend/.env` | 仅公开 RPC/网络/浏览器配置；销售开关 false | `VITE_TOKEN_ADDRESS=UNDEPLOYED`、`VITE_INSURANCE_ADDRESS=UNDEPLOYED`；未浏览器联调 |

用户原有 `0x9208707E8d967365901b54249D335CAc5B10829c` 仅用作投保账户；未读取或导出该钱包的密钥。专用账户密钥未写入报告、Git 跟踪文件或日志。环境状态是**准备完成／待部署**，并非运行验收完成。`env:check deployed` 在占位符下应失败；部署后必须重跑。测试网地址有 EIP-7702 委托标记，浏览器兼容性仍需实际测试，不能凭地址代码作否定判断。

## 安全与依赖

- `npm audit --omit=dev --json`：根、oracle、升级 React Router 后的 frontend 均 0 个生产依赖告警。原先前端 React Router 的 2 个中危已通过升级至 7.18.4 并构建消除。
- 全量审计仍有根 Hardhat/Toolbox 开发工具链 **51 项**（19 low、12 moderate、19 high、1 critical）和前端 Vite/source-map-js **3 项**（1 moderate、2 high）；oracle 0。它们不在生产依赖集合，但本地编译/开发服务器有使用面。限制开发服务器只在本机、避免不可信工程输入；阶段三前审视工具链升级。未运行 `audit fix --force`。
- `npm run secret:scan` 提交前复核 69 个交付文件，0 项命中；后续提交前仍应重跑。公开证据只保留脱敏状态，绝不提交真实 .env、SQLite、私钥或带凭据 URL。

## 尚未验证及门槛

1. 用户明确确认 At gate 口径及单源延迟/更正限制，或给出替代指标；当前只是建议。
2. 真实未来航班需独立官方逐班计划证据，包括计划起飞、计划到达、航班身份/代码共享，保全原文与抓取时刻。历史接口的 `time` 不能冒充未来原计划。
3. Sepolia 部署、链上配置、持续预言机运行、真实钱包和未来航班从投保到结算均未验证。部署前需要专用账户测试 ETH、gas 估算和阶段三授权。
4. 合约别名映射只能拒绝**已登记**的别名重复；现实同一航班未提交的别名仍需人工核对。哈希只能证明已保存字节未变，不能证明来源真实性。

阶段三步骤见 `phase3-handoff-2026-10-26.md`。本报告只代表本地阶段二验收，不能作为对真实销售开放的许可。
