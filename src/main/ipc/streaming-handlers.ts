import type Database from 'better-sqlite3'
import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { sseDraftSchema, webSocketDraftSchema } from '../../shared/streaming/streaming-schemas'
import { SseConnectionService } from '../sse/sse-connection-service'
import { WebSocketConnectionService } from '../websocket/websocket-connection-service'
import { StreamingHistoryService } from '../streaming/streaming-history-service'
import type { ResponseResourceRegistry } from '../response/response-resource-registry'
const id = z.string().uuid(),
  fail = (code: string, message: string) => ({
    ok: false,
    error: { code, category: 'streaming', message, retryable: false },
  })
export function registerStreamingHandlers(
  db: Database.Database,
  options: {
    assetRoot: string
    resources: ResponseResourceRegistry
    resolveFile: (ref: string) => Promise<{ bytes: Buffer; filename: string }>
  },
) {
  const emit = (payload: any) => BrowserWindow.getAllWindows()[0]?.webContents.send('streaming:event', payload),
    variables = (workspaceId: string) => {
      const selected = (
        db.prepare('SELECT value FROM app_settings WHERE key=?').get(`selectedEnvironment:${workspaceId}`) as any
      )?.value
      return selected
        ? db
            .prepare('SELECT key,value,is_secret FROM environment_variables WHERE environment_id=?')
            .all(selected)
            .map((v: any) => ({ key: v.key, value: v.value, isSecret: Boolean(v.is_secret) }))
        : []
    },
    ws = new WebSocketConnectionService(db, {
      assetRoot: options.assetRoot,
      resources: options.resources,
      resolveFile: options.resolveFile,
      emit,
    }),
    sse = new SseConnectionService(db, { emit }),
    history = new StreamingHistoryService(db)
  for (const row of db.prepare('SELECT * FROM stream_resources').all() as any[])
    void options.resources
      .register(
        {
          historyId: row.session_id,
          source: 'stream-record',
          kind: row.kind,
          declaredMimeType: null,
          detectedMimeType: row.mime_type,
          effectiveMimeType: row.mime_type,
          byteLength: row.byte_length,
          suggestedFilename: row.suggested_filename,
          warnings: JSON.parse(row.warnings_json),
          path: row.path,
        },
        row.id,
        null,
        false,
      )
      .catch(() => undefined)
  ipcMain.handle('websocket:connect', (_e, input) => {
    const p = webSocketDraftSchema.safeParse(input)
    try {
      if (!p.success)
        return fail('invalid_websocket_request', p.error.issues[0]?.message || 'Invalid WebSocket request.')
      if (
        !db
          .prepare('SELECT 1 FROM saved_requests WHERE id=? AND workspace_id=? AND protocol=?')
          .get(p.data.savedRequestId, p.data.workspaceId, 'websocket')
      )
        return fail('websocket_request_not_found', 'Saved WebSocket request not found in this workspace.')
      const run = ws.start(p.data, variables(p.data.workspaceId))
      void run.opened.catch((error) =>
        emit({
          type: 'lifecycle',
          protocol: 'websocket',
          connectionId: run.connectionId,
          sessionId: run.sessionId,
          requestId: p.data.savedRequestId,
          state: 'failed',
          timestamp: Date.now(),
          error: { code: error.code || 'websocket_connection_failed', message: error.message },
        }),
      )
      return { ok: true, data: { connectionId: run.connectionId, sessionId: run.sessionId } }
    } catch (error: any) {
      return fail(error.code || 'websocket_connection_failed', error.message)
    }
  })
  ipcMain.handle('websocket:disconnect', (_e, input) => {
    const p = z.object({ connectionId: id }).strict().safeParse(input)
    return p.success
      ? { ok: true, data: ws.disconnect(p.data.connectionId) }
      : fail('websocket_connection_not_found', 'Invalid connection.')
  })
  for (const [channel, key] of [
    ['text', 'text'],
    ['json', 'text'],
    ['binary', 'base64'],
    ['file', 'fileRef'],
  ] as const)
    ipcMain.handle(`websocket:send-${channel}`, async (_e, input) => {
      const p = z
        .object({ connectionId: id, [key]: z.string().max(channel === 'binary' ? 70 * 1024 * 1024 : 50 * 1024 * 1024) })
        .strict()
        .safeParse(input)
      if (!p.success) return fail('websocket_send_failed', 'Invalid message.')
      try {
        const value = (p.data as any)[key]
        if (channel === 'text') await ws.sendText(p.data.connectionId, value)
        if (channel === 'json') await ws.sendJson(p.data.connectionId, value)
        if (channel === 'binary') await ws.sendBinary(p.data.connectionId, value)
        if (channel === 'file') await ws.sendFile(p.data.connectionId, value)
        return { ok: true, data: null }
      } catch (error: any) {
        return fail(error.code || 'websocket_send_failed', error.message)
      }
    })
  ipcMain.handle('sse:connect', (_e, input) => {
    const p = sseDraftSchema.safeParse(input)
    try {
      if (!p.success) return fail('invalid_sse_request', p.error.issues[0]?.message || 'Invalid SSE request.')
      if (
        !db
          .prepare('SELECT 1 FROM saved_requests WHERE id=? AND workspace_id=? AND protocol=?')
          .get(p.data.savedRequestId, p.data.workspaceId, 'sse')
      )
        return fail('sse_request_not_found', 'Saved SSE request not found in this workspace.')
      const run = sse.start(p.data, variables(p.data.workspaceId))
      void run.result.catch((error) =>
        emit({
          type: 'lifecycle',
          protocol: 'sse',
          connectionId: run.connectionId,
          sessionId: run.sessionId,
          requestId: p.data.savedRequestId,
          state: 'failed',
          timestamp: Date.now(),
          error: { code: error.code || 'sse_stream_failed', message: error.message },
        }),
      )
      return { ok: true, data: { connectionId: run.connectionId, sessionId: run.sessionId } }
    } catch (error: any) {
      return fail(error.code || 'sse_stream_failed', error.message)
    }
  })
  ipcMain.handle('sse:stop', (_e, input) => {
    const p = z.object({ connectionId: id }).strict().safeParse(input)
    return p.success
      ? { ok: true, data: sse.stop(p.data.connectionId) }
      : fail('sse_connection_not_found', 'Invalid connection.')
  })
  ipcMain.handle('stream-history:list', (_e, input) => {
    const p = z
      .object({ workspaceId: z.string().regex(/^[A-Za-z0-9_-]+$/), protocol: z.enum(['websocket', 'sse']).optional() })
      .strict()
      .safeParse(input)
    return p.success
      ? { ok: true, data: history.list(p.data.workspaceId, p.data.protocol) }
      : fail('invalid_history', 'Invalid History query.')
  })
  ipcMain.handle('stream-history:get', (_e, input) => {
    const p = z
      .object({ id, workspaceId: z.string().regex(/^[A-Za-z0-9_-]+$/) })
      .strict()
      .safeParse(input)
    if (!p.success) return fail('invalid_history', 'Invalid History query.')
    const session = history.get(p.data.id, p.data.workspaceId)
    return session
      ? { ok: true, data: { session, records: history.records(p.data.id) } }
      : fail('stream_session_not_found', 'Session not found.')
  })
  ipcMain.handle('stream-history:delete', (_e, input) => {
    const p = z
      .object({ id, workspaceId: z.string().regex(/^[A-Za-z0-9_-]+$/) })
      .strict()
      .safeParse(input)
    if (!p.success) return fail('invalid_history', 'Invalid session.')
    const changed = history.delete(p.data.id, p.data.workspaceId)
    if (changed) rmSync(join(options.assetRoot, p.data.workspaceId, p.data.id), { recursive: true, force: true })
    return { ok: true, data: changed }
  })
  ipcMain.handle('stream-history:clear', (_e, input) => {
    const p = z
      .object({ workspaceId: z.string().regex(/^[A-Za-z0-9_-]+$/), protocol: z.enum(['websocket', 'sse']).optional() })
      .strict()
      .safeParse(input)
    if (!p.success) return fail('invalid_history', 'Invalid History query.')
    const sessions = history.list(p.data.workspaceId, p.data.protocol) as any[],
      changed = history.clear(p.data.workspaceId, p.data.protocol)
    for (const row of sessions)
      rmSync(join(options.assetRoot, p.data.workspaceId, row.id), { recursive: true, force: true })
    return { ok: true, data: changed }
  })
  ipcMain.handle('stream-templates:list', (_e, input) => {
    const p = z
      .object({ savedRequestId: z.string().min(1) })
      .strict()
      .safeParse(input)
    return p.success
      ? {
          ok: true,
          data: db
            .prepare('SELECT * FROM stream_message_templates WHERE saved_request_id=? ORDER BY created_at')
            .all(p.data.savedRequestId),
        }
      : fail('invalid_template', 'Invalid template query.')
  })
  ipcMain.handle('stream-templates:save', (_e, input) => {
    const p = z
      .object({
        id: z.string().optional(),
        savedRequestId: z.string().min(1),
        name: z.string().trim().min(1).max(100),
        kind: z.enum(['text', 'json', 'binary']),
        content: z.string().max(50 * 1024 * 1024),
        description: z.string().max(500).default(''),
      })
      .strict()
      .safeParse(input)
    if (!p.success) return fail('invalid_template', 'Invalid template.')
    const templateId = p.data.id || randomUUID(),
      now = new Date().toISOString()
    db.prepare(
      'INSERT INTO stream_message_templates(id,saved_request_id,name,kind,content,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,content=excluded.content,description=excluded.description,updated_at=excluded.updated_at',
    ).run(templateId, p.data.savedRequestId, p.data.name, p.data.kind, p.data.content, p.data.description, now, now)
    return { ok: true, data: db.prepare('SELECT * FROM stream_message_templates WHERE id=?').get(templateId) }
  })
  ipcMain.handle('stream-templates:delete', (_e, input) => {
    const p = z.object({ id }).strict().safeParse(input)
    if (!p.success) return fail('invalid_template', 'Invalid template.')
    db.prepare('DELETE FROM stream_message_templates WHERE id=?').run(p.data.id)
    return { ok: true, data: null }
  })
  return {
    ws,
    sse,
    disconnectAll: () => {
      ws.disconnectAll()
      sse.stopAll()
    },
    cleanupWorkspace: (workspaceId: string) => {
      history.clear(workspaceId)
      rmSync(join(options.assetRoot, workspaceId), { recursive: true, force: true })
    },
  }
}
