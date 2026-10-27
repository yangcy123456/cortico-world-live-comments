# 本机检查记录

核对日期：2026-10-27。环境为 Windows、本机 Coopanion 0.2.11、World API 6、Node.js 24.21.0。本记录只描述实际检查过的范围。

## 已通过（0.1.0 / 0.2.0 时期，当时名字还是 `live-window`）

| 检查 | 实际结果 |
| --- | --- |
| `node --test tests/core.test.mjs` | 10 项通过：历史基线、连续两帧识别、去重、回复时效、草稿、重复发送阻止、未知回执、暂停失效、自身回声、来源与朗读冲突。 |
| `node --experimental-transform-types scripts/check.mjs` | 调用当前框架真实的 manifest / dryMountWorld / checkDescribe 检查；8 项 OK，无 warning / failure。 |
| `node scripts/native-check.mjs` | 8 项通过：选定窗口截图、本地中文 OCR、只读校准、窗口身份和尺寸检查、填写/发送/清空、已有原稿保护、等待按钮期间修改文字的保护、未知回执。只操作本地假直播窗口。 |
| 官方扩展检查、安装、重启 | 安装 `cortico-world-live-window@0.1.0` 成功；重启后扩展 `loaded`，World `active`。本机相对路径通过检查。 |
| 页面与工具 | 实际打开“窗口评论”页面；面板及样式正常显示，JS/CSS 均 HTTP 200。注册 `livewin_status` / `livewin_recent` / `livewin_reply`，全部活跃 World 的工具名无重复。 |
| 旧扩展保留 | 原有 6 个扩展的依赖声明、链接目标、版本、包清单、入口和面板文件哈希一致；依赖锁的 packages 内容一致。启用新 World 后，配置除新增 `worlds.live-window` 外与安装前一致。 |
| 现有发声路径 | 0.1.0/0.2.0 时运行配置检查为仅 `fatfish` 朗读；旧 `bili-live` 和 `voice` 未启用，新插件当时没有自建语音引擎。0.3.0 起本插件自带 Edge TTS 副本，实测见下一节。 |

安装前备份保存在 `_backups/2026-10-27T09-07-24-675Z/`，含配置、扩展清单、锁文件及检查结果；其中可能含凭据，仅供本机恢复，勿公开。

## 1.0.0：改名、迁移与发布包（本机已跑过）

公开身份从 `cortico-world-live-window`（World id `live-window`）改成 npm 包 `cortico-world-live-comments`（World id `live-comments`，显示名「直播互动助手」）：包名、`cortico.displayName`、`icon`（`assets/icon.svg`）、`locales`、`keywords`（含 `cortico-world`，市场按此收录）、工具 `livecom_status` / `livecom_recent` / `livecom_reply`、事件 `livecom.comments`、人格占位 `{{livecom.*}}`、设置分组 `world:live-comments.voice` / `.weights`、记忆目录 `data/live-comments/` 全部同步。

| 检查 | 实际结果 |
| --- | --- |
| 单测 | `node --test tests/*.test.mjs` → **41 pass / 0 fail**（含新增 `tests/migrate.test.mjs` 的 5 项迁移测试）。 |
| 契约 | `scripts/check.mjs --write-describe` 重生成 `describe.json` 后复跑：8 项 OK、`warnings: []`、`failures: []`；`id = live-comments`、3 个 `livecom_*` 工具、`envPromptVars` 4 个、面板 1 个、设置分组 2 个。 |
| 装机 | 通过 Coopanion 接口把新包名装进扩展目录（`pnpm add` 生成 `cortico-world-live-comments` 指向本文件夹），随后卸载旧登记名；扩展依赖表只剩新名，全流程输出 `Already up to date`、无依赖变动。 |
| 重启加载 | 整机重启后 bootId `6b93a2c9-0fb3-4f6e-84e2-997e08016dcc`，`/api/worlds` 列出 `live-comments`；面板 `world:live-comments` 可用。 |
| 旧配置迁移 | 启用后配置自动生成 `worlds.live-comments`：`target`（hwnd 1903058 / livehime）、`crop {0.828,0.30,0.170,0.690}`、`cropConfirmed: true`、`layout 2560×1528@144`、`selfNames`、`weights {1,3,1.5,0}`、`selfSpeak: on`、`outputDevice`，并写了 `migratedFrom: "live-window"`；旧段落 `worlds.live-window` 保留未动。 |
| 记忆文件迁移 | 记忆落到 `data\home\companion\data\live-comments\memory.json`（旧的扁平 `data\memory.json` 作为残留保留，不再写入）。 |
| 采集与朗读 | 面板 RPC `start` → `running: true`、`captures` 递增、`captureBackend: "Windows.Graphics.Capture"`；`speechTest` → 日志 `朗读：…` / `朗读完成：…（LegionZone虚拟扬声器 (LZVirtualDevic）`，`snapshot.speech.device` 回填、`playerError` 与 `lastError` 均为空。 |
| 发布包 | `npm pack` → `cortico-world-live-comments-1.0.0.tgz`（31 个文件、70,630 字节），内容含 `index.js`、`lib/**`、`dist/**`、`vendor/**`、`native/**`、`assets/icon.svg`、`ENV_PROMPT.md`、`describe.json`、`README.md`、`LICENSE`；不含 `node_modules`、`tests`、`scripts`、`evidence`。解压后 `native/worker.ps1` 仍以 `EF BB BF` 开头；在临时目录里 `import` 解压后的 `index.js` 成功，返回 `{"id":"live-comments","label":"直播互动","tools":["livecom_status","livecom_recent","livecom_reply"],"events":["livecom.comments"]}`。 |

仍然没有的证据：从 npm registry 真实安装（本地只用目录安装验证过）；带非空记忆的旧世界升级；`webUiStyle` 在真实浏览器里的最终渲染；以及 1.0.0 之后一条真实观众评论走完“识别 → 回复 → 朗读 → 记忆”。

## 0.3.1：播放设备（接虚拟麦克风）

把独立语音插件 `cortico-world-voice` 的“选播放设备 → 直播软件从配对虚拟麦克风收声”这一套搬进本插件：`lib/speech/audio/voiceplay.cs`（原文逐字复制，waveOut 原生播放器，首次使用用 `csc` 编成 exe）、`lib/speech/audio/native.js`（编译/设备枚举/按设备播 WAV）、`lib/speech/audio/decode.js`（MP3 → WAV，`mpg123-decoder` wasm）、`lib/speech/speaker.js` 改为“原生播放器优先、MCI 兜底”、配置项 `worlds.live-window.outputDevice`（`x-options: livewindow.devices`，热生效）、面板第 4 段加设备下拉框与「刷新设备」。

| 检查 | 实际结果 |
| --- | --- |
| `node --test tests/*.test.mjs` | 19 项全过（9 核心 + 10 语音，新增设备解析、设备选项表、设备设置项 3 项）。 |
| `node --experimental-transform-types scripts/check.mjs` | 8 项 OK，无 warning / failure；`describe.json` 与代码仍一致。 |
| 重启加载 | `POST /api/run/restart` 后 `ready:true`，`/api/worlds` 里 `live-window` 为 `active`，朗读灯 `online`。 |
| 设备枚举 | 面板 RPC `devices` 返回真实列表：`[{index:0,name:"扬声器 (Realtek(R) Audio)"},{index:1,name:"LegionZone虚拟扬声器 (LZVirtualDevic"}]`；名字被 Windows `MAXPNAMELEN` 截到 32 字符属正常现象，按片段匹配（`LegionZone`）仍可选中。`voiceplay.exe` 因此在首次调用时编译成功并缓存。 |
| 按设备播放 | `speechDevice` 设为 `LegionZone虚拟扬声器 (LZVirtualDevic` → 配置里 `outputDevice` 落盘；`speechTest` 后日志 `朗读：设备选择测试，能听到吗？` → `朗读完成：…`，`snapshot.speech.device` 回填该设备名，`playerError` 为空，**日志里没有“原生播放器不可用”，即走的是 waveOut 指定设备而不是默认设备的 MCI 兜底**。 |
| 两个已知坑 | ① PowerShell 5.1 发 JSON 时若不带 `charset=utf-8` 并把 body 转成 UTF-8 字节，中文会被写成 `?`，于是“未知的播放设备”和 Edge 的 `No audio data received`；这是测试写法问题，不是插件问题。② 播放成功后 `mouth.lastError` 未清空会导致状态栏残留旧错误，已修（成功即清）。 |

还没有的证据：耳机/虚拟声卡真的出声（只能确认 waveOut 打开了该设备并按时长播完）、换设备后的直播间实际收音、macOS 分支。

## 尚未验证（接更早的空白）

检查时有直播姬后台进程，但没有可见、可采集的直播姬/直播助手窗口。因此尚未验证该软件实际版本的截图效果、右下角评论框选、输入框/发送按钮是否开放辅助功能接口，以及真实直播间的发送结果。

0.1.0 那一轮没有向真实直播间发送测试评论，也没有以一次真实观众事件验收模型回复和声音播放；后来 0.2.0 用真实直播姬窗口补上了“读评论 → 当前人格 → Coo 气泡 → 大肥鱼朗读”的端到端证据（`evidence/coo-live-test.json`）。状态“待命”不等于已听到实际声音，要在 Coo 页看到气泡、亲耳听到，或日志里出现 `fatfish speaking: …` 才算。

## 0.3.2：礼物 + 弹幕同框 + 回复权重（已在本机跑过）

框选从“右下角评论列表”放大到**整条右侧互动栏**：面板加了「框选整个互动栏（礼物+弹幕）」按钮（预设 `{x:0.828,y:0.30,width:0.170,height:0.690}`），OCR 一行分四类 `chat/gift/follow/enter`（`lib/comments.js` 的 `classify()`），每类一个**用户可改的权重**（面板四个数字框 + 设置分组 `world:live-window.weights`，都写 `worlds.live-window.weights.*`），权重高的先投喂、权重 0 只显示不投喂。

| 检查 | 实际结果 |
| --- | --- |
| `node --test tests/*.test.mjs` | 26 项全过（9 核心 + 10 语音 + 7 权重/分类）。新增覆盖：`classify()` 认礼物/关注/进场；`parseLines()` 带 `kind`；`weightOf()` 默认值、夹到 0–10、非法值回退；`byWeight()` 礼物压过弹幕、权重 0 被剔除、同权重按到达顺序；权重设置分组四类齐全；互动栏标题/空状态/计数行被丢弃。过程中修掉两个测试写错：`normalize()` 会吃掉中文之间的空格（`送出 火箭` → `送出火箭`），没有冒号的行整行都算 `text`。 |
| `node --experimental-transform-types scripts/check.mjs` | 8 项 OK、`warnings: []`、`failures: []`、退出码 0；`webUi()` 现在报 **config groups: 2**（语音 + 权重）。`livewin_recent` 的描述加上了 kind/weight，`describe.json` 已同步。 |
| 整条互动栏采集 | 直播姬重开过（hwnd 由 395458 变 1903058）后重新绑定；用预设框选整栏，`preview` → `configure` → `start`，`captures` 递增、`backend = Windows.Graphics.Capture`，识别结果里出现互动栏标题与空状态文案。 |
| 噪音过滤 | 未过滤时读出 `直播互动`、`展示本场直播的弹幕互动消息`、`送礼、醒目留言、上舰消息等显示在这里`、`¥ 0`、`0 0 凸 0`；加 `CHROME`/`NUMERIC` 两道过滤后同样的画面 `visible = 0`——没有评论时不产生假评论。（当时没有观众发言，所以还没在真实弹幕上验证分类是否准确。） |
| 权重面板入口 | 面板 RPC `weights {kind,value}` 可写；`GET /api/config` 的 `world:live-window.weights` 正常渲染（标题「回复权重」），`POST /api/config` 写 `worlds.live-window.weights.chat=4` 后重回读为 4，热生效不用重启；测试后已恢复 `chat=1 / gift=3 / follow=1.5 / enter=0`。 |
| 重启加载 | `POST /api/run/restart` 后 `ready:true`（bootId `d1d42c44-2268-4246-997a-278cf5e49105`），`live-window` 正常加载，没有重现 0.3.0 那种静默消失。 |

仍然没有的证据：真实观众弹幕/礼物走一遍“分类 → 按权重投喂 → 回复 → 念出”（采集时没有观众发言）；直播姬窗口只剩 `直播互动` 空态，所以“礼物行 OCR 会不会把金额数字混进昵称”也还没看到样本。

## 0.3.3：弹幕记忆（本机已跑过）

新增 `lib/memory.js`：观众消息落盘成一份纯文本记忆（`ctx.dataDir` 下的 `memory.json`），最多 500 条、同一人 10 分钟内重复同一句只记一条、坏文件改名 `.broken` 后从空记忆继续；`index.js` 在采集新评论时 `add()`、模型回复后 `attachReply()`、`stop()` 时 `flush()`，`envPromptVars()` 提供 `{{livewin.memory}}`（最近 10 条摘要），面板第 5 段可改文字/写备注/删单条/清空（清空需再确认）。

| 检查 | 实际结果 |
| --- | --- |
| `node --test tests/*.test.mjs` | **36 项全过**（9 核心 + 10 语音 + 7 权重 + 10 记忆）。记忆覆盖：重启后重载、同人同话去重且 10 分钟后算新、空文本拒绝与 200 字截断、超上限丢最旧、编辑与回复、评论 ID 变了仍按“昵称 + 内容”挂上回复、remove/clear 计数、空态与摘要格式、坏文件隔离成 `.broken` 后仍可继续记。 |
| `node --experimental-transform-types scripts/check.mjs` | 重写 `describe.json` 后复跑：8 项 OK、`warnings: []`、`failures: []`；`envPromptVars` 由 3 个增至 **4 个**、config groups 仍 2 个。 |
| 重启加载 | `POST /api/run/restart` → `ready:true`（bootId `0904bc1c-53c4-47fb-8129-ac3e35294f54`）；面板 `snapshot.memory` 返回 `{size:0,lastError:'',file:'D:\直播\Coopanion\data\home\companion\data\memory.json',items:[]}`，由此确认数据目录实际落点。 |
| 读入与删改 | 人工写入两条记忆后 `POST /api/worlds/restart`：`memory` 返回 2 条；`memoryUpdate` 改文字 + 备注后条目带 `edited` 时间戳；`memoryRemove` 返回 `removed:1`；不带确认调 `memoryClear` 被拒（`清空记忆需要再次确认`），带 `confirm:true` 后文件变成 `{"version":1,"entries":[]}`（33 字节），重载 `size=0`。 |
| 人格摘要 | 用插件同款 `CommentMemory` 读真实文件，`digest(10)` 输出 `- 熬夜牛马_悲（弹幕）：主播今晚播到几点呀（备注：记得回答时间） → 你回过：播到十二点`——这就是塞进 `{{livewin.memory}}` 的文本。 |
| 自动记录（真实链路） | 直播间当时没有观众发言，于是把 crop 临时对准会自己变化的窗口状态文字（左下角 `CPU: x% 内存: y%`，`{x:0.170,y:0.955,w:0.150,h:0.035}`）：OCR 先读出 `CPU: 0 . 4 % …` 作为基线，等待约 45 秒后数值变化产生两条新评论 `comments=2`，`memory=2`，`memory.json` 实际写入 411 字节，条目带 `kind:'chat'`、`at` 时间与生成的 ID——**采集 → 新评论 → 记忆落盘 → 文件** 这条链路成立。 |
| 收尾状态 | 测完清空记忆、把 crop 还原成整栏预设（`{0.828,0.30,0.170,0.690}`）并重新 `preview → configure → select → start`：`running=true`、`captures` 递增、`visible=0`（互动栏当时是空态）、`lastError` 为空。 |

仍然没有的证据：真实观众弹幕自动进记忆（本轮用会变化的窗口文字代替，OCR 有错字属正常，面板可改）；面板第 5 段在浏览器里的实际渲染只通过 RPC 数据核对，没逐帧截图；带非空记忆跑一次真实回复，确认模型确实引用记忆里的人名/话题。

## 0.3.0：自带语音引擎（已在本机跑过）

把大肥鱼的语音朗读整套复制进本插件：`vendor/msedge-tts/`（Edge 客户端逐字副本，仅第 22 行的 `ws` 导入改为 `ws-loader.js`）、`lib/speech/`（音色/语音包/清理/播放器/轮询）、`dist/webui.js` 第 4 段朗读控制、设置分组 `world:live-window.voice`、`package.json` 的 `ws` 依赖，另把 `ws@8.22.0` 复制了一份到插件的 `node_modules/ws`（148 KB），引擎不再依赖扩展目录里那份。

| 检查 | 实际结果 |
| --- | --- |
| 加载 | 第一次装完 0.3.0 时插件**从 World 列表消失**：`lib/config.js:21` 的描述里用了单引号内的 `extension's`，模块 `SyntaxError: Unexpected identifier 's'`，Coo 直接跳过整个 World。把该句改成 `the built-in Edge TTS engine of this extension`（`describe.json` 同步）后恢复。重启后 `/api/worlds` 列出 `live-window`，日志有 `World 已启动: live-window` 与 `窗口评论语音朗读已就绪。` |
| `node --test tests/*.test.mjs` | 16 项全过（9 项窗口/Coo 核心 + 7 项语音）。过程中修掉两个真问题：`lineOf()` 原先不看 `event.type`，非 `desktop-pet.self` 的事件也会被念；`speaker.speak()` 成功后不清理 `lastError`，状态栏会一直显示上一次失败。 |
| `node --experimental-transform-types scripts/check.mjs` | 8 项 OK，无 warning / failure；面板 1 个、设置分组 1 个、prompt 1 份、`envPromptVars` 3 个；`describe.json` 与代码自描述一致。 |
| 设置分组 | `GET /api/config` 里 `world:live-window.voice` 正常渲染，8 个键的值已实际写入运行配置（`ttsEnabled=true`、`selfSpeak=auto`、`voice=zh-CN-XiaoxiaoNeural` 等）；`/api/config/options/livewindow.voices` 返回 19 个音色，`livewindow.presets` 返回 10 项（自定义排第一）。 |
| 真实合成与播放 | 通过面板 RPC 调 `speechTest`，日志依次出现 `朗读：…` 和 `朗读完成：…`，状态 `speaking` 由 true 回到 false、`lastError` 为空；独立脚本另测合成产物为 16,128 字节 MP3。纯乱码/空文本会得到 `朗读合成失败：No audio data received`，失败后 10 秒冷却。 |
| 让位与接管 | `selfSpeak=on` → `route.active=true`（热生效，无需重启）；`auto` 且大肥鱼启用 → `active=false`（原因“让位给已启用的 fatfish”）；把大肥鱼临时停用 → `active=true`、`others=[]`；再启用 → 回到 `false`。测试后大肥鱼已恢复启用。 |

仍然没有的证据：一条真实观众评论走完“识别 → 回复 → 本插件念出”的完整链路（需要直播软件窗口开着并在直播），真的卸载大肥鱼（只用停用验证过让位），以及 macOS 的 `afplay` 分支。

本机运行检查原始摘要见 `evidence/runtime.json`；面板截图见 `evidence/panel.png`。这些文件及备份默认不进入版本管理。
