# COMP7610 阶段三操作与交接

本文只针对 Sepolia（chainId 11155111）课程演示。FDT 是零小数位的测试代币，不是现金或真实保险。历史回放、合成模拟、未来航班事前投保必须分别标注。当前合约和账户的**实际状态**以 `deployments/sepolia.json` 和[阶段三A验收](phase3a-acceptance-2026-10-26.md)为准。2026-10-26 已部署并链上暂停；目前无登记航班、无投保。

## 1. 身份与文件

| 角色 | 公开地址 | 私有配置 |
|---|---|---|
| 保险方／部署者 | `0xDc376E51a2845A1FFac0A71952dAFd30f1d7F53a` | 仓库根 `.env` 中的专用测试密钥 |
| 预言机 | `0x3C65B6280BeCCdb01857B53579407Bf026B1F939` | `oracle/.env` 中的独立测试密钥 |
| 投保用户 | `0x9208707E8d967365901b54249D335CAc5B10829c` | 用户 MetaMask；项目不持有其密钥 |

三份实际 `.env` 被 Git 忽略，不复制到公开报告、干净验收目录或同伴机器。`.env.example` 是结构模板。公开部署清单不含密钥。当前 token 为 `0x350B48d0BB1f44764b04155AC2E4970A339f66b7`，保险为 `0x0E8A379CA510aae2580a15A22F0A97BBF370da73`，保险部署块 `11999004`。部署后 `npm run env:prepare` **不可再运行**。

## 2. 新目录本地复现

在固定 `icn` 提交的新 clone 中安装 Node 22、Python 3.11；不要复制原目录的 `.env`、数据库、`node_modules`、`artifacts`、`dist` 或虚拟环境。Windows PowerShell 示例：

```powershell
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
```

若使用 `uv`，可改用 `uv venv .venv --python 3.11` 与 `uv pip install --python .venv\Scripts\python.exe -r test_python\requirements.txt`。`py-solc-x` 首次需要取得 solc 0.8.24。`local:e2e` 只发送到隔离的 31337；结尾预期池 9840 FDT、预留 0，并分别标记历史回放和模拟。

## 3. Sepolia 部署与防重做

本次五笔部署已完成；下列命令保留供审阅和**同一公开清单下的异常续作**，不要再次从空目录部署。原操作目录先运行 `npm run compile`、`npm run abi:check`、`npm run env:check -- deployed`，确认工作树中的源码提交、chainId、公开账户、余额和预算。用户仅授权过本次五笔，未授权新航班登记、开售或买家签名。本次批准的参数为：

```powershell
$env:SEPOLIA_BROADCAST_AUTHORIZED = 'true'
$env:SEPOLIA_BUDGET_ETH = '0.08'
$env:SEPOLIA_MAX_FEE_GWEI = '10'
npm run deploy:sepolia
```

脚本只允许 Sepolia，顺序执行：部署 DemoToken、部署 FlightDelayInsurance、授权 10000 FDT、注资 10000 FDT、合约 `pause()`。每步先写公开 intent，再写交易哈希，确认后立即写回执到 `deployments/sepolia.json`。本次 RPC 超时发生在授权交易哈希保存之后；重跑从链上确认该哈希并完成注资、暂停，未重复部署。遇到以后相同情况，使用**同一源码提交、同一预算和原命令**续作；已有哈希未确认就等待，intent 无哈希则停下核查，绝不盲目重新部署。不要删除清单来“重试”。

## 4. 配置回填和只读验收

已只修改原有文件中的确定字段，保留其余值和密钥：`oracle/.env` 的 `CONTRACT_ADDRESS`、`DEPLOY_BLOCK`；`frontend/.env` 的 `VITE_TOKEN_ADDRESS`、`VITE_INSURANCE_ADDRESS`。`DEPLOY_BLOCK` 等于保险合约**部署交易回执**的 blockNumber `11999004`。前端 RPC、chainId、数据库路径保持原值。接手时：

```powershell
npm run env:check -- deployed
npm --prefix frontend run build
```

该检查已通过：字节码、合约 token/oracle/insurer、初始池 10000、预留 0、暂停 true，及每笔链上交易回执一致。前端 `.env` 变化后需重启 Vite/浏览器服务。不可把部署验收当作钱包交互或真实航班结算验收。

## 5. 服务启动、停止和恢复

预言机从其独立 Sepolia SQLite 路径运行；应先确认配置对应链、合约地址和精确部署块。前台启动：

```powershell
npm --prefix oracle run start
```

保持终端运行；停止用该终端 `Ctrl+C`。重启仍使用同一 `oracle/.env` 和 `oracle/oracle-sepolia.sqlite`，服务会按确认块和重叠区间回扫事件，避免重复处理。不要删数据库来修复未知状态。2026-10-26 已验证启动、停止、重启：scope 为 `11155111:0x0e8a379ca510aae2580a15a22f0a97bbf370da73`，检查点由 `11999014` 前进到 `11999017`，请求数 0。日志如有 403、歧义、尚未发布或未知格式，只能继续 pending，并按配置低频重试。服务启动成功不等于已有真实回调；真实交易需核对请求、原始响应、证据哈希、回调回执和保单终态。

前端开发服务：`npm --prefix frontend run dev -- --host 127.0.0.1`；在其终端 `Ctrl+C` 停止。浏览器用买家原 MetaMask 连接 Sepolia，用户本人解锁、批准连接和签名；投保 `approve` 仅 10 FDT。先测网络/地址显示、错链禁写、切账户重连、领 200 FDT 和回执。用户钱包的 EIP-7702 标记不能单独作为拒绝理由，以实际交互为准。

## 6. 真实航班门槛与结算

在首份购买**之前**，独立保全官方逐班计划起飞/到达、航段、日期时区、运营号和代码共享、抓取时刻、原始资料及哈希。当前候选为 [10 月 29 日 SQ898](phase3-sq898-candidate-2026-10-29.md)，备选为 [10 月 30 日 SQ898](phase3-sq898-backup-2026-10-30.md)；都尚未登记。用户已接受 [教学条款 v1](teaching-terms-v1-2026-10-26.md)；销售还需同时满足：合约解除暂停、仅核准航班 `sellable=true`、前端销售开关为 true、当前链时间不晚于计划起飞前 24 小时。缺任一门槛则不买，不倒填。

购买后立即保存钱包交易和区块时间，核对用户 FDT -10、资金池 +10、赔付预留 +100、保单 Active。到计划香港到达日结束后再请求核验；官方历史数据若未发布、403、缺失、冲突或格式未知就保持 pending。预言机原始字节哈希只证明本地字节一致，不证明机场资料真实或以后不会更正。准点结案不赔也是有效真实闭环；本地模拟退款不能冒充真实七天退款。

## 7. 合并与交接

最终交接应包含：固定源码 SHA、公开部署清单和回执、两个官方计划来源及哈希、事前购买和事后结算证据、脱敏环境状态、服务接续命令、实际未完成项。队友先 `git fetch origin`，在独立 checkout 对比 `origin/icn` 与 `origin/main`，复跑本地命令并审核公开证据。只有在用户最终发布授权和 main 关系核对后才合并；若分叉，使用常规 PR/集成流程，不强推，不删除 `icn`。
