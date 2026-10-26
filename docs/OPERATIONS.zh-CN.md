# COMP7610 阶段三操作与交接

本文只针对 Sepolia（chainId 11155111）课程演示。FDT 是零小数位的测试代币，不是现金或真实保险。历史回放、合成模拟、未来航班事前投保必须分别标注。当前合约和账户的**实际状态**以 `deployments/sepolia.json`、`deployments/flight-sq898-2026-10-29.json` 及[阶段三B实时记录](phase3b-live-status-2026-10-27.md)为准。合约已部署；29 日 SQ898 已登记并开售，买家已在截止前购买 Active 保单；真实航班结果等待到达后核验。

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

本次五笔部署已完成；下列命令保留供审阅和**同一公开清单下的异常续作**，不要再次从空目录部署。原操作目录先运行 `npm run compile`、`npm run abi:check`、`npm run env:check -- deployed`，确认工作树中的源码提交、chainId、公开账户、余额和预算。用户先授权了五笔部署交易，随后另行授权了 10 月 29 日 SQ898 的登记和开售两笔交易；买家领取及投保由本人签名。以下参数仅说明当时批准的部署预算，不能视为新交易授权：

```powershell
$env:SEPOLIA_BROADCAST_AUTHORIZED = 'true'
$env:SEPOLIA_BUDGET_ETH = '0.08'
$env:SEPOLIA_MAX_FEE_GWEI = '10'
npm run deploy:sepolia
```

脚本只允许 Sepolia，顺序执行：部署 DemoToken、部署 FlightDelayInsurance、授权 10000 FDT、注资 10000 FDT、合约 `pause()`。每步先写公开 intent，再写交易哈希，确认后立即写回执到 `deployments/sepolia.json`。本次 RPC 超时发生在授权交易哈希保存之后；重跑从链上确认该哈希并完成注资、暂停，未重复部署。遇到以后相同情况，使用**同一源码提交、同一预算和原命令**续作；已有哈希未确认就等待，intent 无哈希则停下核查，绝不盲目重新部署。不要删除清单来“重试”。

## 4. 配置回填和只读验收

已只修改原有文件中的确定字段，保留其余值和密钥：`oracle/.env` 的 `CONTRACT_ADDRESS`、`DEPLOY_BLOCK`；`frontend/.env` 的 `VITE_TOKEN_ADDRESS`、`VITE_INSURANCE_ADDRESS`、`VITE_DEPLOY_BLOCK`，以及经授权开售后的 `VITE_SALES_ENABLED`。`DEPLOY_BLOCK` 和 `VITE_DEPLOY_BLOCK` 都等于保险合约**部署交易回执**的 blockNumber `11999004`。前端 My Policies 从该块开始分段查事件，避免公共 RPC 拒绝创世以来的宽范围查询。前端 RPC、chainId、数据库路径保持原值。接手时：

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

本机当前另用隐藏进程运行 Sepolia oracle。公开 PID 写在 `courses/COMP7610/evidence/phase3-oracle-sepolia.pid`，标准输出/错误分别为同目录的 `phase3-oracle-sepolia.stdout.log`、`phase3-oracle-sepolia.stderr.log`。在仓库根目录检查、停止、重新启动：

```powershell
$oracleDir = (Resolve-Path 'oracle').Path
$evidenceDir = (Resolve-Path '../evidence').Path
$node22 = 'F:\Environment\Node\node-v22.23.2-win-x64\node.exe'
$pidFile = Join-Path $evidenceDir 'phase3-oracle-sepolia.pid'
$oraclePid = [int](Get-Content -LiteralPath $pidFile)
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$oraclePid"
if ($process -and $process.ExecutablePath -eq $node22 -and $process.CommandLine -like '*tsx*src/index.ts*') {
    Get-Content -LiteralPath (Join-Path $evidenceDir 'phase3-oracle-sepolia.stdout.log') -Tail 20
    # Only when a restart is needed:
    Stop-Process -Id $oraclePid
}
$cli = (Resolve-Path 'oracle/node_modules/tsx/dist/cli.mjs').Path
$p = Start-Process -FilePath $node22 -ArgumentList ('"' + $cli + '" src/index.ts') `
    -WorkingDirectory $oracleDir -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $evidenceDir 'phase3-oracle-sepolia.stdout.log') `
    -RedirectStandardError (Join-Path $evidenceDir 'phase3-oracle-sepolia.stderr.log') -PassThru
[System.IO.File]::WriteAllText($pidFile, [string]$p.Id)
```

不要靠删 SQLite 停止服务。机器关机或休眠会停止轮询；跨日结算前须重新核对进程、数据库检查点及日志。本机进程存活不等于结束聊天后我会主动跟进。

前端开发服务：`npm --prefix frontend run dev -- --host 127.0.0.1`；在其终端 `Ctrl+C` 停止。浏览器用买家原 MetaMask 连接 Sepolia，用户本人解锁、批准连接和签名；投保 `approve` 仅 10 FDT。领币、授权、购买及原买家地址的 EIP-7702 实际交互已成功。Chrome MetaMask 显示“以太坊”时，页面刷新／重连后仍显示 Sepolia 保单，错链禁写验收没有通过；用户要求暂缓该项修复。原因查明并复测前，不在该浏览器会话发起写操作。账户切换重连也仍待实测。

## 6. 真实航班门槛与结算

在首份购买**之前**，独立保全官方逐班计划起飞/到达、航段、日期时区、运营号和代码共享、抓取时刻、原始资料及哈希。[10 月 29 日 SQ898](phase3-sq898-candidate-2026-10-29.md) 已经独立授权、复核并登记为航班 1；[10 月 30 日 SQ898](phase3-sq898-backup-2026-10-30.md) 仅是未登记备选。用户已接受 [教学条款 v1](teaching-terms-v1-2026-10-26.md)；销售同时满足：合约解除暂停、仅核准航班 `sellable=true`、原机器前端开关为 true、当前链时间不晚于计划起飞前 24 小时。到截止即不可购买，不倒填。

用户随后另行授权了**仅限 10 月 29 日 SQ898** 的两笔保险方交易：全局暂停保护下登记（该航班 `sellable=true`），再解除全局暂停；新增总预算 0.02 Sepolia ETH、每笔 maxFeePerGas 不超过 10 gwei。该授权不含备选航班，也不代替买家钱包签名。登记脚本先核对原计划文件哈希 `0x1075e638cf62a9b3499f8e5cd4b07fcfb90f927ee6c32f48c01c8e38490597cd`、链上角色/资金/暂停、链上时间距销售截止至少还有一小时，并重新从航空公司和香港机场官方页面抓取计划。任一来源改变或不可用即停。获得授权后的原工作目录命令：

```powershell
$env:FLIGHT_BROADCAST_AUTHORIZED = 'true'
$env:FLIGHT_BUDGET_ETH = '0.02'
$env:FLIGHT_MAX_FEE_GWEI = '10'
npm run admit:sq898
```

脚本将新抓原文保存到本机 `courses/COMP7610/evidence/`，将抓取时间与哈希、交易 intent/哈希/回执保存到 `deployments/flight-sq898-2026-10-29.json`。中断只用相同源码提交和相同参数续作；无哈希 intent 要人工核 nonce，不删除清单重新做。两笔完成、实际官网资料再次一致后，才将原 `frontend/.env` 的 `VITE_SALES_ENABLED` 改为 `true` 并重启前端。开售后若需立刻止售，保险方调用 `pause()` 或 `setFlightSellable(flightId,false)`；关前端按钮只是附加保护。

买家已亲自签署 [10 FDT 授权](https://sepolia.etherscan.io/tx/0xc4030032172a9a765d4258eaa219abd12f24cf14551e60d09a2c33d8fc5464ee)和[投保交易](https://sepolia.etherscan.io/tx/0x94d9f9ac3c45c5c6ade5ebd11125fa3f8ce622fc46e289addea50f3c4f56839b)。后者在 27 日 00:17:48 HKT 进入区块，比截止早 153432 秒；用户 FDT 200→190、资金池 10000→10010、赔付预留 0→100、保单 0 为 Active。完整读链证据见 `courses/COMP7610/evidence/phase3-sq898-purchase-chain-evidence-2026-10-27.json` 和[阶段三B记录](phase3b-live-status-2026-10-27.md)。到计划香港到达日结束后再请求核验；官方历史数据若未发布、403、缺失、冲突或格式未知就保持 pending。预言机原始字节哈希只证明本地字节一致，不证明机场资料真实或以后不会更正。准点结案不赔也是有效真实闭环；本地模拟退款不能冒充真实七天退款。

## 7. 合并与交接

最终交接应包含：固定源码 SHA、公开部署清单和回执、两个官方计划来源及哈希、事前购买和事后结算证据、脱敏环境状态、服务接续命令、实际未完成项。队友先 `git fetch origin`，在独立 checkout 对比 `origin/icn` 与 `origin/main`，复跑本地命令并审核公开证据。只有在用户最终发布授权和 main 关系核对后才合并；若分叉，使用常规 PR/集成流程，不强推，不删除 `icn`。
