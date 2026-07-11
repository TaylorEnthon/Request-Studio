# Request Studio Milestone 3 中文报告

## 1. 最终结论

Milestone 3 功能提交 `2c1bc6b` 已完成本地与 Windows CI 闭环，无功能阻断，可以进入 Milestone 4。

## 2. Git 状态

起始 `main`/`origin/main` 为 `494642b`，设计提交为 `bd9f12e`，功能提交为 `d939e96`、`b33ed5e`、`2c1bc6b`。采用普通 push，无 rebase、force push 或用户文件删除。最终文档提交与远端状态以本报告提交后的 CI 为准。

## 3. CodeGraph

开始时索引为 43 文件、317 节点、686 边且最新。CodeGraph 定位了 `HttpExecutionService` 的 Base64 IPC、History 单文件清理、Preload 契约和单体 Response Panel。合并后同步 35 个变更文件，新增 20、修改 15，共解析 298 个节点，并复核 classifier → execution → registry → protocol → viewer 与 History cleanup 调用链。

## 4. 设计与计划

设计见 `docs/superpowers/specs/2026-07-11-request-studio-milestone-3-media-design.md`，计划见 `docs/superpowers/plans/2026-07-11-request-studio-milestone-3-media.md`。选择“inline 文本 + 全部媒体受管资源 + 自定义协议”，未引入生产依赖。

## 5. 响应分类

支持 MIME 小写、参数/charset、`+json`、`+xml`；有限签名表覆盖 PNG/JPEG/GIF/WebP/BMP/ICO/SVG、WAV/MP3/Ogg/FLAC/AAC/M4A、MP4/WebM、PDF、ZIP/GZIP/RAR/7z、PE/ELF。签名优先于冲突 MIME，明确文本可降级，未知内容进入 binary，并显示非绝对化 warning。

## 6. Resource 架构

schema v3 的 `response_resources` 记录随机 resource ID、History 所有权、分类、大小、内部路径和摘要。`request-studio-resource://app/resource/<uuid>` 只解析注册资源；realpath 必须位于 `history-assets`。支持完整、open-ended、closed、suffix Range，206/416、`Content-Range`、`Accept-Ranges` 和流式文件读取。启动恢复注册并清理确认无 DB 所有者的目录。

## 7. Image Viewer

原生 `<img>` 预览 PNG/JPEG/GIF/WebP/BMP/ICO，提供 Fit、100%、缩放、自然宽高、文件大小、MIME、100MP 风险提示、Save As 和解码错误 fallback。SVG 不注入 DOM。

## 8. Audio Viewer

原生 `<audio controls>` 提供播放、暂停、进度、音量、静音、倍速、循环和 duration。WAV/MP3/Ogg/FLAC/AAC/M4A 的识别与 Chromium 实际 codec 支持分开表述；受管文件支持 Range。

## 9. Video Viewer

原生 `<video controls>` 提供播放、暂停、进度、音量、全屏、循环、duration 和宽高。识别 MP4/WebM/Ogg 容器，不转码；Chromium 不支持的 codec 显示解码失败但仍可保存。

## 10. PDF Viewer

PDF 使用指向受控协议的 sandbox iframe，不授予脚本、弹窗或 Node 权限；主窗口拒绝新窗口和非允许导航。未引入 PDF.js，因此不伪造页数；自动化覆盖 descriptor、协议、签名、sandbox 属性和失败边界，不声称覆盖所有 Chromium PDF UI。

## 11. Binary Viewer

只读取前 4096 字节（IPC 上限 16 KiB），显示 Hex、ASCII、MIME、大小、签名信息和 Save As。PE/ELF 显示安全警告，绝不自动执行或打开。

## 12. Base64

JSON 字符串节点提供 Copy value、Copy JSON Path、Inspect as Base64。支持普通 Base64、Data URL、空白、可补齐的无 padding；严格拒绝非法字符/padding。输入上限 70 MiB 字符，解码前估算，解码上限 50 MiB；解码后重新做签名分类，MIME 冲突给 warning。History ID + SHA-256 去重，错误和日志不回显 payload。

## 13. History Asset 生命周期

目录为 `history-assets/<workspace>/<history>/`。History 重启恢复、单条删除、clear、500 条淘汰、Workspace 删除和 orphan cleanup 都只作用于受管目录。数据库先确定删除，再做受限文件清理；用户 Save As 文件和请求上传源文件不属于该目录，不会被清理。

## 14. IPC 与安全

保持 `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`。Preload 只暴露 descriptor、16KiB bounded preview、resource Save As、inline response Save As、Base64 inspect/extract；没有通用 readFile/saveFile/path/file URL。输入使用 Zod，Renderer 不接收绝对路径。CSP 禁止远程/inline script、object、form 和 base；HTML/XML/SVG 不执行，文件不 auto-open。

## 15. UI

Response tabs 按类型显示 Overview/Headers/Preview、Binary 或 Pretty/Raw；Overview 展示分类、声明/检测 MIME、存储方式和 warning。History detail 复用同一 Response Panel。资源缺失、解码失败、保存失败和 Base64 检查错误均为局部状态，不影响整个应用。

## 16. 测试

`npm ci` 成功安装 334 packages。`lint`、`typecheck`、`build`、`test:all`、`smoke:database`、`smoke:media`、`smoke:electron`、ABI 恢复后的 database test、`git diff --check` 均通过。全量为 20 个文件、71/71；媒体专项为 7 个文件、42/42；database 为 4/4；无 skipped、无 flaky 标记。fixture 仅绑定 `127.0.0.1`，临时目录/server/DB/Electron 均清理。

## 17. CI

Workflow `CI`，`windows-latest`，Node 22。功能 Run `29172331034`，Job `86595440747`，commit `2c1bc6b1612faaa3a6527f418ff2c967e04e361a`，时长 2m16s，conclusion `success`。`npm ci`、lint、typecheck、71 tests、build、database smoke、42 media tests、media smoke、Electron smoke、ABI 恢复 database test 全部执行且通过，无 `continue-on-error`。

## 18. 主要文件

`src/main/response/*` 负责分类、签名、Range、注册、协议、Base64 和文件名；`response-resource-handlers.ts` 负责受控 IPC/保存；`http-execution-service.ts` 负责流式接收与 History 资产化；`response-contracts.ts` 定义共享类型；`renderer/features/response/*` 负责 JSON、媒体和 Binary Viewer；`media-smoke.ts` 与 mock server 提供本地闭环。

## 19. 范围核对

未实现 WebSocket、SSE、流式媒体播放、音频分片合并、Experiment、Compare、curl 导入、代码生成、installer、safeStorage migration、媒体编辑、OCR 或 AI 分析。

## 20. 已知限制

播放取决于 Chromium codec；sandbox PDF 的内置 Viewer 行为取决于 Electron/Chromium，未提供页数；Base64 解码最大 50 MiB；超大图片只警告、不转码；大文本落盘仅显示 prefix；GUI smoke 不验证真实扬声器输出。Environment secret 仍以明文存储于本地 SQLite，含脱敏凭据的 History 仍禁止直接重放。

## 21. 下一步建议

下一阶段仅建议 Milestone 4 — WebSocket & SSE Streaming：连接生命周期、消息时间线、文本/JSON/二进制消息、SSE event 解析、重连策略、流指标和后续独立设计的音频分片合并。
