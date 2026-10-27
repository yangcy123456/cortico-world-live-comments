# 直播互动助手（cortico-world-live-comments）

把直播软件互动栏里的**弹幕、礼物、关注、进场**读给 Coopanion，让**当前 Coo 人格**替你接话：回复显示在 **Coo 对话页和桌宠气泡**里，由插件自带的语音引擎念出来，并记进一份**可删可改的弹幕记忆**。

**1.0.1 支持 B 站直播姬 / 直播助手与抖音直播伴侣。** 窗口保持打开即可；被其他窗口覆盖或放在另一个虚拟桌面时仍可采集。最小化的窗口无法读取。

它是 Coopanion 的独立 World 扩展（World API 6）：不新建模型、不新建人格，用的就是你正在用的角色。语音引擎（Edge TTS）和播放器（可选输出设备）都随插件分发，**卸载大肥鱼等其它朗读插件后仍能独立发声**。

- 工具：`livecom_status` / `livecom_recent` / `livecom_reply`
- 事件：`livecom.comments`
- 设置分组：`world:live-comments.voice`（语音朗读）、`world:live-comments.weights`（回复权重）

## 它是怎么工作的

```
直播软件窗口 ──截图(Windows.Graphics.Capture)──▶ 本地中文 OCR ──▶ 新评论判定
      │                                                              │
      │                                        ┌─────────────────────┘
      │                                        ▼
      │                              投给当前 Coo 人格（World 事件）
      │                                        │
      │                              livecom_reply 登记回复 → pet_say
      │                                        ▼
      └───────────────── 自带 Edge TTS 合成 ─▶ 指定播放设备（虚拟扬声器可让直播间听见）
                                               │
                                    弹幕记忆（可删可改，进人格上下文）
```

不往直播软件的输入框写字，不操作直播软件界面：只读窗口、只在自己的进程里发声。

## 环境要求

- Windows 10/11（窗口抓取与中文 OCR 用系统组件；macOS 只有朗读的 `afplay` 分支，窗口采集不可用）
- Coopanion 便携版 0.2.x，World 契约 api 6
- 直播姬 / 直播助手 / 直播伴侣 / 抖音直播这类 Chromium 壳的推流软件，窗口**不要最小化**
- 联网：Edge 在线语音（`api.msedgeservices.com`）

## 安装

三种来源任选一种，装完都要**重启 Coopanion 进程**，再到 World 总览里启用「直播互动」。

1. **扩展市场**：Coopanion → 扩展 → 搜索「直播互动助手」。市场按 npm 关键字 `cortico-world` 找包，本包已带这个关键字。
2. **npm 包**：扩展页 → 手动安装 → 填 `cortico-world-live-comments`（可带已发布的 `@版本`；本地修复版不代表已发布到 npm）。
3. **本地目录**：在输入框填**相对 Coopanion 安装目录下 `resources/app/build/cortico` 的路径**。本机源码目录仍叫 `D:\直播\cortico-world-live-window`，所以填写 `../../../../../cortico-world-live-window`；放到别处后重新计算路径。本地 0.2.11 会拒绝中文绝对路径，用相对路径最稳。

开发者本机也可以直接用 Coopanion 自己的接口安装（会先备份）：

```powershell
node scripts/install.mjs      # 需要 Coopanion 已运行在 127.0.0.1:17788
```

### 从旧名字升级

1.0.0 之前叫 `cortico-world-live-window`（World id `live-window`）。新版第一次启动时会**自动把旧段落里的窗口、框选、权重和朗读设置搬过来**，并把旧的 `memory.json` 搬到新目录；搬完在配置里留一个 `worlds.live-comments.migratedFrom = "live-window"` 标记，只搬一次。之后旧名字的扩展条目可以卸载。

## 第一次设置

1. 打开直播姬/直播助手，保持窗口未最小化；在面板第 1 段「刷新窗口」→ 选中正确窗口 →「绑定窗口」。窗口被别的窗口盖住、甚至丢到另一个虚拟桌面，都还能继续读。
2. 点「预览并框选评论区」。可以用 **「框选右侧互动栏（参考范围）」**，参考区域为 `x 0.828 / y 0.30 / w 0.170 / h 0.630`，再按实际画面调整；不要框到观众榜、复盘统计或底部输入框。填自己的昵称（可选、逗号分隔）后点「保存评论区」。
3. 可先点「检查识别（不回复）」核对现有评论。这个检查不会投给模型或写入弹幕记忆。确认后点「开始采集」；首帧只当历史基线，新评论连续两帧出现后才算新增。
4. 点「开启 Coo 回复」。读取 **B站** 窗口时应停用旧的 B站直播间输入源，防止重复；读取 **抖音** 窗口时，B站通道属于另一个平台，不会因此拦截抖音回复。
5. 按需调第 3 段权重、第 4 段语音（先点「试听」确认本机能出声）、第 5 段记忆。语音包、音色、语速、音高、音量、播放设备在设置分组里改。

### 抖音评论没有出现时

- 直播伴侣必须停在有评论列表的主界面。直播结束后的「直播复盘／数据汇总」页没有实时评论；新版会明确提示，阻止把复盘页存成评论区域。
- 「评论区尚未保存」「采集已暂停」「区域没有文字」「首帧历史」现在分别显示，不再一律显示“等待直播互动”。展开「查看识别原文」可核对 OCR 实际读到了什么。
- `123`、`666`、`1` 等纯数字评论会保留；只有带 UI 符号的计数、与输入框占位文字同行的字符计数等被排除。OCR 把“昵称：”和正文拆成相邻两行时，会合并回一条评论。
- 抖音的整段平台安全提示会被过滤，避免“礼物消费”等提示词被误判为观众送礼。昵称仍可能有 OCR 错字，不把识别结果当作平台账号的精确身份。
- 已经显示在窗口里的那条评论属于启动历史。要立即验收，先开启 Coo 回复，再点该行的「交给 Coo 回复」；不用反复发送同一条测试消息。

## 面板每一段

| 段 | 作用 |
| --- | --- |
| 1. 选择直播软件窗口 | 枚举可采集窗口，绑定后用窗口句柄+尺寸+DPI 做身份校验，窗口换了会重新要求框选 |
| 2. 框选评论区 | 整窗预览 + 拖框，有「整条互动栏」预设；保存后绑定到当前窗口尺寸和缩放 |
| 3. 读取评论、交给 Coo | 开始/暂停采集、开启 Coo 回复、四个权重数字框、识别文字与新评论状态 |
| 4. 语音朗读（自带引擎） | 模式（自动/总是/关闭）、播放设备、刷新设备、试听、停止朗读 |
| 5. 弹幕记忆（可删可改） | 列出记忆，逐条改文字、写备注、删除、清空全部 |

## 礼物、弹幕与回复权重

框到整条互动栏后，每行会分四类（`kind`）：

| 类型 | 认法（关键词） | 默认权重 |
| --- | --- | --- |
| `gift` 礼物 | 送出 / 投喂 / 打赏 / 礼物 / 小心心 / 辣条 / 灯牌 / 上舰 / 大航海 / 火箭 / 嘉年华 / 办卡 / 月卡 / 电池 | 3 |
| `follow` 关注 | 关注了 / 互粉 / 粉丝团 / 点亮 / 赞了 | 1.5 |
| `chat` 弹幕 | 其余带昵称的消息 | 1 |
| `enter` 进场 | 进入直播间 / 来了 / 回到直播间 | 0（只显示，不投喂） |

权重**用户可改**，两处入口等价：面板第 3 段的数字框，或设置分组「回复权重」（值在 `worlds.live-comments.weights.*`）。范围 0–10、可小数、改完立即生效。

- 投喂按权重从大到小排，权重 0 的行标成「权重 0（不投喂）」，不占每分钟投喂额度。
- 交给模型的 JSON 带 `kind` 和 `weight`，提示词说明 `gift`/`follow` 不是普通弹幕，模型据此决定先答谁。
- 面板识别行显示 `[礼物 · 权重 3]` 前缀，随时核对分类；分错了调权重即可。

互动栏的标题、空状态和计数（`展示本场直播的弹幕互动消息`、`¥ 0`、`0 0 凸 0` 等）会被丢弃，不会当成评论。

## 语音朗读（自带引擎）

`vendor/msedge-tts/` 是 Edge 在线语音客户端的逐字副本，`lib/speech/` 是音色表、语音包、文本清理与播放器，全部随包分发。

- **合成**：走 `wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1`，需要联网；文本按规则清理并截到 600 字。
- **播放**：Windows 优先用自带原生播放器 `lib/speech/audio/voiceplay.cs`（首次朗读时用系统 `csc` 编译成小 exe 并缓存），走 `waveOut`，**能播到指定输出设备**；解码或编译不可用时退回 `powershell` + `winmm` MCI（只到系统默认设备）。macOS 用 `afplay`。临时音频放系统临时目录，读完即删。
- **音色/语音包**：19 个音色、9 套语音包 + 自定义，语速/音高/音量可单独覆盖。
- **不重复念**：同一句 10 秒内不重复；「停止朗读」丢弃排队并结束当前音频。

### 播放设备与虚拟麦克风

第 4 段的「播放设备」和设置分组里的「播放设备」是同一个值（`worlds.live-comments.outputDevice`）。想**让直播间观众听到**：

1. 播放设备选虚拟扬声器（`LegionZone虚拟扬声器`、`CABLE Input`、`VoiceMeeter` 等）；
2. 直播软件「设置 → 音频」把麦克风选成配对的那个虚拟麦克风（`LegionZone虚拟麦克风`、`CABLE Output` 等）。

留空 = 系统默认设备，只有你自己听得到。设备列表来自 Windows `waveOut` 枚举，点「刷新设备」重读；名字被截到 32 字符是正常的（`LegionZone虚拟扬声器 (LZVirtualDevic`），选择按片段匹配。

### 让位规则

模式「自动」时，如果 `fatfish`（启用且装了包）或 `voice`（启用）已经在朗读，本插件就不出声，避免两路声音重叠；想只留本插件，把它们停用或选「总是」。判定同时看**配置里启用**和**包是否真的装着**，所以卸载了包但配置还留着 `enabled: true` 不会让本插件一直闭嘴。

### 依赖说明

`package.json` 声明了两个运行时依赖：`ws`（Edge 客户端用的 WebSocket）和 `mpg123-decoder`（把 MP3 解成 WAV 才能按设备播放）。安装时由包管理器装齐；`ws` 运行时额外按以下顺序兜底，方便在扩展目录里复用现有副本：

1. 插件自己的 `node_modules/ws`
2. Coopanion `data/extensions/node_modules/ws`
3. 环境变量 `LIVECOM_EXTENSIONS_DIR`（旧名 `LIVEWIN_EXTENSIONS_DIR` 也认）指向的目录
4. 裸 `ws`

都找不到时面板显示 `EDGE_TTS_NO_WS`：朗读报错，采集与回复不受影响。

## 弹幕记忆（可删可改）

采集到的观众消息都会记进一份纯文本记忆，重启、关软件之后还在：

- 文件：World 数据目录下的 `memory.json`（本机 `D:\直播\Coopanion\data\home\companion\data\live-comments\memory.json`）；最多 500 条，超出丢最旧；同一人 10 分钟内重复同一句只记一条。
- 面板第 5 段可**改文字**（保存即生效）、**写备注**、**删除单条**、**清空全部**（需再确认一次）；打字时列表不重绘。
- 进人格上下文的是最近 10 条摘要（`{{livecom.memory}}`），格式 `- 昵称（弹幕）：内容（备注：…） → 你回过：…`。角色可沿用其中人名和话题，但不得编造；与当前消息冲突时以当前消息为准。
- 回复成功会挂到对应记忆（先按评论 ID，ID 变了再按「昵称 + 内容」），面板显示「已回复」。
- 文件读坏不拖垮直播：改名成 `memory.json.broken`，从空记忆继续，并在面板显示原因。
- 只记「新」评论；OCR 可能带错字，可直接在面板里改掉。

## 与其它插件的关系

- **B站直播间输入源**：两路同时读同一片弹幕会重复回复，所以在采集/投喂时会检查它是否启用，启用中直接拒绝并提示。
- **桌宠**：回复走 Coo 自己的 `pet_say`，所以必须启用桌宠（Coo）。
- **朗读**：按上面的让位规则与 `fatfish` / `voice` 共存，不会双播。

## 边界与已知限制

- 窗口画面用 `Windows.Graphics.Capture` 抓选定窗口（GDI `PrintWindow` 对直播姬这类 Chromium 壳拿到空白，已弃用），不退回整屏截图；被覆盖、跨虚拟桌面都能读，全屏独占或受保护内容可能失败。
- 中文识别用系统自带 `OcrEngine`，缺中文语言组件会明确报错。
- OCR 没有平台消息 ID：可能认错昵称/标点/换行，也可能漏掉滚动过快、只出现一帧的消息；20 秒内相同文字会合并，不能当完整弹幕存档。内存里只留最近 100 条评论。
- 截图只用于本机预览与本地识别，**不外发**；观众内容始终标记为 `external`，不当成操作者指令。
- 直播姬以管理员身份运行时，后台窗口消息（`WM_SETTEXT` 等）对普通进程返回错误 5；本插件只读窗口，不依赖后台输入，所以不受影响。
- 重启后要重新点「开始采集」；移动窗口不用重新框选，改窗口大小或应用内布局后要重新预览框选。

## 排错

- **找不到窗口**：恢复直播软件主窗口/评论窗口后点「刷新窗口」；只剩后台进程不算有可采集窗口。
- **整个 World 在列表里消失**：扩展加载失败，Coopanion 会静默跳过。跑 `node --experimental-transform-types scripts/check.mjs` 与 `node --test`；`core.log` 里搜 `World 已启动:`，没有 `live-comments` 就是它没起来。
- **面板显示 `EDGE_TTS_NO_WS`**：`ws` 找不到（见上面四级顺序），放回一份即可；采集和回复仍然正常。
- **不发声但面板显示「开」**：先点「试听」。Edge 在线语音要网络，代理拦 `api.msedgeservices.com` 会报合成失败；也可能「自动」模式让位给了仍在启用的朗读插件。成功朗读的日志是 `朗读完成：<前 20 字>（<设备>）`。
- **模型不回应**：确认已「开启 Coo 回复」、旧 B站输入源已停用、评论不是首帧历史或自己说的话、当前模型正常。
- **框选后又说没保存**：换窗口会清掉旧框选；同一窗口、同尺寸重绑会保留。

## 开发与发布

```powershell
node --test tests/*.test.mjs                      # 单元测试
node --experimental-transform-types scripts/check.mjs   # 契约自检（describe.json 与代码一致）
node scripts/native-check.mjs                     # 本地假窗口：OCR、身份保护、原稿保护
```

`scripts/check.mjs` 带 `--write-describe` 会在改动工具/事件/ENV_PROMPT 后重新生成 `describe.json`。

发布（npm）：

```powershell
npm pack                        # 生成 cortico-world-live-comments-1.0.0.tgz，用来交付或本地安装
npm publish --access public     # 发布到 npm，扩展市场按关键字 cortico-world 收录
```

发布前确认：`package.json` 的 `type: "module"`、`cortico.api = 6`、`keywords` 含 `cortico-world`、`files` 覆盖 `index.js / lib / dist / vendor / native / assets / ENV_PROMPT.md / describe.json`，以及 `LICENSE` 里的版权人改成你自己。

## 源码入口

| 文件 | 职责 |
| --- | --- |
| `index.js` | World 生命周期、评论投喂、Coo 回执、语音接线、面板接口、旧配置迁移 |
| `lib/config.js` | id、默认值、工具/事件声明、权重与设置分组 |
| `lib/comments.js` | OCR 行整理、四类识别、互动栏噪音过滤、首帧基线与两帧稳定 |
| `lib/memory.js` | 弹幕记忆：落盘、去重、可删可改、给人格的摘要 |
| `lib/migrate.js` | 旧 `live-window` 段落与记忆文件的单次迁移 |
| `lib/native.js` | 带超时和退出清理的本机辅助进程 |
| `lib/speech/settings.js` | 语音默认值、模式、`resolveSpeak`、设备选项、设置分组 |
| `lib/speech/voices.js` / `clean.js` | 音色与语音包表、可朗读文本清理 |
| `lib/speech/speaker.js` | Edge 合成 + 播放调度（waveOut 选设备，失败退回 MCI / afplay） |
| `lib/speech/audio/native.js` / `voiceplay.cs` | 原生播放器：编译、设备枚举、按设备播 WAV |
| `lib/speech/audio/decode.js` | MP3 → WAV（mpg123 wasm） |
| `lib/speech/mouth.js` | 轮询 Coo 事件、串行朗读、去重与停止 |
| `lib/speech/paths.js` | 定位插件目录、扩展目录与已安装的包 |
| `vendor/msedge-tts/` | Edge TTS 客户端副本（只把 `ws` 导入换成 `ws-loader.js`） |
| `native/CaptureInterop.cs` / `WindowBridge.cs` | 窗口身份校验与 Windows.Graphics.Capture 抓帧 |
| `native/worker.ps1` | Windows 中文 OCR 与本机请求通道；必须保留 UTF-8 BOM |
| `dist/webui.js` / `dist/webui.css` | 面板五段：框选、采集、权重、朗读、记忆；无构建步骤 |

接口依据：[Windows.Graphics.Capture](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturepicker)、[OcrEngine.RecognizeAsync](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.recognizeasync)、[mciSendString](https://learn.microsoft.com/en-us/windows/win32/api/winmm/nf-winmm-mcisendstringa)，以及本机 Cortico 的 `src/world.ts`、`src/core/types.ts`、`src/extensions/manifest.ts`。

## 许可与作者

作者：yangcy123456（[@yangcy123456](https://github.com/yangcy123456)）。

MIT，见 [LICENSE](./LICENSE)。
