export type Protocol = 'http' | 'websocket' | 'sse'
export interface NamedEntity { id: string; name: string; createdAt: string; updatedAt: string }
export interface Workspace extends NamedEntity {}
export interface Collection extends NamedEntity { workspaceId: string }
export interface Environment extends NamedEntity { workspaceId: string }
export interface EnvironmentVariable { id: string; environmentId: string; key: string; value: string; isSecret: boolean; description: string; createdAt: string; updatedAt: string }
export interface SavedRequest extends NamedEntity { workspaceId: string; collectionId: string; protocol: Protocol; method: string | null; url: string; description: string }
export interface RequestStudioError { code: string; category: 'validation'|'database'|'ipc'|'file'|'security'|'unknown'; message: string; detail?: string; retryable: boolean }
export type Result<T> = { ok: true; data: T } | { ok: false; error: RequestStudioError }
