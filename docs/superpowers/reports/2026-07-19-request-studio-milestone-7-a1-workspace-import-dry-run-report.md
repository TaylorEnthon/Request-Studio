# Request Studio — Milestone 7 Phase A1 最终报告

## 1. 最终结论

Milestone 7 Phase A1 已完成产品实现、独立审查、完整本地验证、PR #14 squash merge 和合并后 `main` CI。交付的是纯函数、只读的 Workspace Import 契约与 dry-run 分析基础；它不会创建、修改或删除任何 Workspace 数据。

当前能力可以作为 Phase A2 transactional apply 的输入契约，但 Phase A2 必须另行设计事务、ID 映射、策略选择和 Main 安全边界，不能把本阶段的 conflict strategies 误认为已执行。

## 2. Git 状态

- 开始基线：`main`，`HEAD = origin/main = 5f4ab57a49499101625ae347ad001297ec3464a1`，ahead/behind `0/0`，working tree clean。
- 功能分支：`codex/milestone-7-a1-workspace-import-dry-run`。
- 功能提交：
  - `5640368` `docs: design workspace import dry-run`
  - `f1abf83` `docs: plan workspace import dry-run`
  - `ee626f0` `feat: add workspace import parser contract`
  - `10120b6` `feat: add workspace import dry-run planner`
- PR：[#14 — Milestone 7 Phase A1 — Workspace Import Dry-Run Foundation](https://github.com/TaylorEnthon/Request-Studio/pull/14)。
- 合并方式：squash merge，无冲突。
- 产品 squash commit：`ce3f4fce02e146c9816bb36b9742f8fecedd7e4f`。
- 产品合并后本地 `main` 已 fast-forward 到该 commit，且当时 `HEAD = origin/main`、ahead/behind `0/0`、working tree clean。
- 本报告通过独立 docs-only closure 提交；它不修改产品代码。

## 3. CodeGraph

开始时主工作区索引为 148 files / 1,469 nodes / 4,176 edges。功能实现后索引同步为 150 files / 1,514 nodes / 4,415 edges；squash merge 后主工作区重新同步为 150 files / 1,514 nodes / 4,410 edges，状态均为 up to date。边数差异来自独立 worktree 与 squash 后索引解析状态，不影响文件或符号结论。

关键入口与调用链：

```text
untrusted text
→ parseWorkspaceImportSource()
→ UTF-8 size / root / depth / dangerous-key preflight
→ workspaceExportV1Schema
→ RequestAssetV1 protocol validation
→ import semantic validation
→ validated WorkspaceExportV1
→ createWorkspaceImportDryRun()
→ readonly target snapshot
→ conflict analyzer
→ dependency-ordered metadata-only operations
```

CodeGraph 确认新增能力只位于 `src/shared/assets/workspace-import.ts` 及其测试。它复用 `WorkspaceExportV1`、`RequestAssetV1` 和现有 output sanitizer；没有进入 Repository、SQLite、Main IPC、Preload、Renderer、文件系统或网络调用链。`codegraph affected` 仅定位到新增测试文件。

没有发现需要复制的新验证器。Import 特有的变量名 100 字符限制和 non-empty secret slot 拒绝属于输入语义边界；其他结构、名称、Request protocol 与 item limits 继续由现有 export/request schemas 负责。

## 4. Contract 与输入限制

- 输入入口：`parseWorkspaceImportSource(source)`，只接受已读取出的字符串，不接受路径。
- Bundle：仅接受严格的 `request-studio.workspace` version `1`。
- 输出：versioned、readonly、JSON-serializable 的 `request-studio.workspace-import-dry-run` version `1`。
- 最大源文本：16 MiB UTF-8，在 `JSON.parse` 前检查，限制复制和解析成本。
- 最大 JSON 深度：64，使用迭代 preflight，避免递归遍历自身造成堆栈耗尽。
- Collections：最多 1,000。
- Requests：最多 10,000。
- Environments：最多 100。
- 每个 Environment variables：最多 1,000。
- 单个 Request 序列化字符数：最多 1,000,000。
- Workspace、Collection、Request、Environment 名称继续使用现有 100 字符严格 schema。

空输入、非字符串、非法 JSON、primitive/array/null root、未知字段、错误 format/version、超限、危险键和 schema/semantic 错误均返回固定 code 与固定安全文案，不包含原 bundle、路径、SQL、stack 或 cause。

## 5. Semantic Validation

- Collection refs 必须唯一；每个 Request 的 `collectionRef` 必须存在。
- Request 继续完整通过 `RequestAssetV1`，没有绕过 HTTP/WebSocket/SSE discriminated protocol 组合校验。
- Environment Variable key 使用真实 resolver 语法 `[A-Za-z_][A-Za-z0-9_]*`，Import 上限为 100 字符；同一 Environment 内按现有 SQLite 语义进行 case-sensitive duplicate 检查。
- `isSecret: true` 的 value 必须为空；发现非空值直接拒绝，绝不“清空后继续”。
- strict schemas 拒绝 database IDs、timestamps、History、Experiment、Compare、Resource、runtime metadata、managed paths 和任意扩展字段。

Version 1 的 variables 结构上嵌套在 Environment 内，因此不存在可单独表达的 Environment ref、孤立 variable 或 wrong-entity variable ref。Requests 也没有独立 source ref 字段，因此“duplicate request refs”在 v1 wire format 中不可表达。本阶段没有为满足示例测试名而破坏现有 version 1 契约。

## 6. Dry-Run Architecture

```text
Workspace JSON Bundle
→ Safe Parser
→ WorkspaceExportV1 + RequestAssetV1 Validation
→ Import Semantic Validation
→ Readonly Target Snapshot
→ Conflict Analyzer
→ Deterministic Operation Planner
```

支持两种只读模式：

- `create-workspace`：使用现有 Workspace 名称列表分析 Workspace 冲突。
- `merge-into-workspace`：使用调用方已限定到单个 Workspace 的最小快照，分析 Collection/Request/Environment/Variable 冲突。

快照只含 Workspace display name、Collection names 与其 Request names、Environment names 与其 Variable keys。传入对象中的额外数据库 ID 不会进入输出。pure mapper 不访问 Repository，也不能跨 Workspace 查询；未来调用方必须在 Main/Repository 边界先完成 ownership 与单 Workspace 限定。

## 7. Conflict Model

冲突 code 与仅建模、未执行的策略：

- `WORKSPACE_NAME_CONFLICT`：`skip`、`rename`。
- `COLLECTION_NAME_CONFLICT`：`skip`、`rename`、`merge`。
- `ENVIRONMENT_NAME_CONFLICT`：`skip`、`rename`、`merge`。
- `VARIABLE_NAME_CONFLICT`：`skip`、`rename`、`replace`。
- `REQUEST_NAME_CONFLICT`：`skip`、`rename`、`replace`。

匹配使用 trim 后的 case-insensitive 名称，作为跨平台 import ambiguity policy；它不改变 SQLite uniqueness。每个 conflict 含固定安全 message、entity type、plan-local source/scope refs、sanitized display name 和实体允许的 strategies，不含 target database ID。

排序固定为 Workspace → Collection → Environment → Variable → Request，再按 sourceRef/code。operations 固定为 create-workspace → create-collection → create-environment → create-variable → create-request，并在同 kind 内按 sourceRef 排序。Workspace 冲突阻断 create-mode 全计划；Collection/Environment 冲突分别向 Request/Variable 子操作传播；被阻断的 operation 保留在计划中。

## 8. Security

- 拒绝 `__proto__`、`prototype`、`constructor`，覆盖 prototype pollution 输入。
- 深度 64 与 16 MiB 输入上限提供资源耗尽边界。
- errors/warnings 使用固定模板；实现没有 console/log 输出。
- secret variable 的非空值被拒绝，ordinary variable values、Request URL/body/auth/headers、descriptions 和完整原 bundle 不进入 dry-run。
- display names 复用 `sanitizeTextForOutput`，Windows、Unix 与 `file://` local paths 不进入输出。
- target snapshot 的数据库 metadata 即使作为额外字段传入也被忽略，不进入 dry-run。
- 无 random ID；只生成 `request-N`、`environment-N`、`environment-N-variable-N` 等确定性 plan-local refs。
- 无数据库、文件系统、网络、IPC、Preload 或 Renderer 访问。

Workspace bundle 无法恢复 secret；secret slots 仍为空，未来必须通过单独的安全输入通道补录。

## 9. TDD、独立审查与测试

新增：

- `src/shared/assets/workspace-import.ts`
- `src/shared/assets/workspace-import.test.ts`
- 本阶段设计、实施计划和本报告。

TDD 证据：parser 首次 RED 因 module 缺失；planner 首次 RED 为 6 个测试因 `createWorkspaceImportDryRun` 缺失。实现后 focused 为 27/27。独立 fresh-pass 审查按 prototype/depth/ref/secret/ID/sorting/dependency/snapshot/log/write 十项边界重新检查，发现 conflict 缺少提示要求的安全 `displayName`；先增加失败回归断言，再复用 sanitizer 修复，最终 focused 27/27。

完整本地验证：

- `npm run lint`：pass。
- `npm run typecheck`：pass。
- `npm test`：59 files / 342 tests pass。
- `npm run build`：pass。
- `npm run test:all`：59 files / 342 tests pass，lint/typecheck/build pass。
- `npm run smoke:database`：pass。
- `npm run smoke:media`：pass。
- `npm run smoke:streaming`：2 files / 4 tests pass。
- `npm run smoke:assets`：pass。
- `npm run smoke:electron`：首次在受限权限下命中 Windows MSBuild FileTracker `E_ACCESSDENIED (0x80070005)`；未改代码，完全相同命令以合理权限重跑后 `electron main smoke passed`。
- Electron 后 `npm run smoke:database`：pass，确认 Node ABI 恢复。
- 最终 focused：1 file / 27 tests pass。
- `git diff --check`：pass。

没有使用公网测试依赖或真实凭据，没有 flaky/skip；smoke 使用既有临时目录清理机制。

## 10. CI

PR #14 CI：

- Workflow：`CI`（workflow ID `311125954`）。
- Run ID：`29674974002`，run #40。
- Job ID：`88160609165`，job `validate`。
- Head：`10120b695f07c87e937f6b21cbe6945c08d00c59`。
- 时间：`2026-07-19T05:31:16Z`–`05:33:39Z`，2 分 23 秒。
- Conclusion：`success`。

产品 squash commit 的 main CI：

- Workflow：`CI`（workflow ID `311125954`）。
- Run ID：`29675058380`，run #41。
- Job ID：`88160910193`，job `validate`。
- Commit：`ce3f4fce02e146c9816bb36b9742f8fecedd7e4f`。
- 时间：`2026-07-19T05:34:31Z`–`05:36:52Z`，2 分 21 秒。
- Conclusion：`success`。

两个 jobs 的 `npm ci`、lint、typecheck、tests、build、database smoke、media tests/smoke、streaming smoke、assets smoke、Electron smoke、Electron 后 database test 均为 success。无 required step skipped，无 `continue-on-error`，无隐藏的 `|| true`。

本报告的 docs-only closure PR/main CI 证据记录在最终交付回复中，因为 commit 无法包含自身未来 merge SHA 与 CI 结果。

## 11. 范围核对

本阶段明确没有实现：

- Database apply / transaction。
- Workspace Import UI、file picker、drag/drop。
- IPC 或 Preload method。
- 自动 rename/replace/merge 或 conflict resolution UI。
- Secret restoration。
- OpenAPI、Postman 或第三方 bundle import。
- Cloud Sync、Collaboration。
- Schema migration。
- History、Experiment、Compare、Resource import。
- 请求执行引擎修改。
- Milestone 7 Phase A2 或更后阶段能力。

## 12. 与提示词差异

- 采用一个 shared module，而非预先拆成多个目录/服务，因为当前没有运行时消费者；这减少未使用架构并保持 pure boundary。
- 没有新增 Repository snapshot 查询。Phase A1 接受最小 readonly snapshot contract；数据库查询和 ownership 属于未来 Main/Repository 集成阶段。
- `targetWorkspaceId` 未进入公开 dry-run，避免暴露数据库 ID；使用 plan-local refs 表达 scope。
- streaming source parser 未实现：输入边界上限为 16 MiB，当前 API 接受完整文本；真正的文件读取/流式导入属于未来 Main 文件边界。
- Environment ref、wrong-entity variable ref、duplicate request ref 在 WorkspaceExportV1 version 1 中不可表达，未发明不兼容字段。
- 名称冲突采用 trim + case-insensitive portability policy，而不是宣称数据库存在相同唯一约束。
- CodeGraph CLI 实际刷新命令为 `sync`，不是旧提示中的 `update`。
- GitHub CLI 本地 token 无效，但 Git push 凭据可用；PR/merge/CI 读取通过已安装 GitHub connector 与官方匿名 Actions API 完成，没有修改认证或 remote。

## 13. 清理结果与 B2.3

产品合并后，A1 功能 worktree/分支和 docs-only closure worktree/分支将在最终 closure CI 成功后删除并 prune；只清理已合并的本阶段引用。

预存 B2.3 worktree 始终 clean，HEAD 始终为 `4e12bc6a3cf88d30487d7bea283a55d00955508c`，分支仍跟踪 `origin/codex/milestone-6-b2-3-curl-import`。由于 `main` 前进，其相对 divergence 从开始时 `11/6` 自然变为 `12/6`；B2.3 自身未修改、未合并、未重置、未 rebase、未删除。

## 14. 最终状态目标

在 docs-only closure merge、最终 main CI success 和安全清理后，交付回复必须再次确认：

```text
HEAD = origin/main
ahead/behind = 0/0
working tree clean
main CI success
B2.3 worktree unchanged
Phase A1 officially closed
```
