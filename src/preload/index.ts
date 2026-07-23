import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, input?: unknown) => ipcRenderer.invoke(channel, input)
contextBridge.exposeInMainWorld('requestStudio', {
  workspaces: {
    list: () => invoke('workspaces:list'),
    create: (input: unknown) => invoke('workspaces:create', input),
    rename: (input: unknown) => invoke('workspaces:rename', input),
    delete: (input: unknown) => invoke('workspaces:delete', input),
    select: (input: unknown) => invoke('workspaces:select', input),
  },
  collections: {
    list: (workspaceId: string) => invoke('collections:list', { workspaceId }),
    create: (input: unknown) => invoke('collections:create', input),
    rename: (input: unknown) => invoke('collections:rename', input),
    delete: (input: unknown) => invoke('collections:delete', input),
  },
  environments: {
    list: (workspaceId: string) => invoke('environments:list', { workspaceId }),
    create: (input: unknown) => invoke('environments:create', input),
    rename: (input: unknown) => invoke('environments:rename', input),
    delete: (input: unknown) => invoke('environments:delete', input),
    getSelected: (workspaceId: string) => invoke('environments:selected:get', { workspaceId }),
    select: (workspaceId: string, environmentId: string | null) =>
      invoke('environments:selected:set', { workspaceId, environmentId }),
  },
  variables: {
    list: (environmentId: string) => invoke('variables:list', { environmentId }),
    create: (input: unknown) => invoke('variables:create', input),
    update: (input: unknown) => invoke('variables:update', input),
    delete: (input: unknown) => invoke('variables:delete', input),
  },
  savedRequests: {
    list: (workspaceId: string) => invoke('requests:list', { workspaceId }),
    create: (input: unknown) => invoke('requests:create', input),
    update: (input: unknown) => invoke('requests:update', input),
    delete: (input: unknown) => invoke('requests:delete', input),
    duplicate: (input: unknown) => invoke('requests:duplicate', input),
  },
  curlImport: {
    preview: (input: unknown) => invoke('curl-import:preview', input),
    save: (input: unknown) => invoke('curl-import:save', input),
  },
  requestExport: {
    preview: (input: unknown) => invoke('request-export:preview', input),
    save: (previewId: string) => invoke('request-export:save', { previewId }),
  },
  workspaceExport: {
    preview: (input: unknown) => invoke('workspace-export:preview', input),
    save: (previewId: string) => invoke('workspace-export:save', { previewId }),
  },
  workspaceImport: {
    preview: (input: unknown) => invoke('workspace-import:preview', input),
    apply: (previewId: string) => invoke('workspace-import:apply', { previewId }),
  },
  codeGeneration: {
    list: () => invoke('code-generation:list'),
    preview: (input: unknown) => invoke('code-generation:preview', input),
  },
  experiments: {
    list: (input: unknown) => invoke('experiments:list', input),
    get: (input: unknown) => invoke('experiments:get', input),
    create: (input: unknown) => invoke('experiments:create', input),
    rename: (input: unknown) => invoke('experiments:rename', input),
    duplicate: (input: unknown) => invoke('experiments:duplicate', input),
    delete: (input: unknown) => invoke('experiments:delete', input),
  },
  experimentRuns: {
    create: (input: unknown) => invoke('experiment-runs:create', input),
    update: (input: unknown) => invoke('experiment-runs:update', input),
    delete: (input: unknown) => invoke('experiment-runs:delete', input),
    execute: (input: unknown) => invoke('experiment-runs:execute', input),
    cancel: (input: unknown) => invoke('experiment-runs:cancel', input),
    send: (input: unknown) => invoke('experiment-runs:send', input),
    compareData: (input: unknown) => invoke('experiment-runs:compare-data', input),
  },
  http: {
    execute: (input: unknown) => invoke('http:execute', input),
    cancel: (executionId: string) => invoke('http:cancel', { executionId }),
    onExecutionEvent: (listener: (event: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on('http:execution-event', handler)
      return () => ipcRenderer.removeListener('http:execution-event', handler)
    },
  },
  files: { selectRequestFile: () => invoke('files:select-request-file') },
  history: {
    list: (workspaceId: string) => invoke('history:list', { workspaceId }),
    delete: (id: string, workspaceId: string) => invoke('history:delete', { id, workspaceId }),
    clear: (workspaceId: string) => invoke('history:clear', { workspaceId }),
    createRequest: (input: unknown) => invoke('history:create-request', input),
    rerun: (id: string, workspaceId: string) => invoke('history:rerun', { id, workspaceId }),
  },
  responseResources: {
    descriptor: (resourceId: string) => invoke('response-resources:descriptor', { resourceId }),
    readPreview: (resourceId: string, offset = 0, length = 4096) =>
      invoke('response-resources:preview', { resourceId, offset, length }),
    saveAs: (resourceId: string) => invoke('response-resources:save-as', { resourceId }),
    saveInline: (content: string, suggestedFilename: string) =>
      invoke('response-resources:save-inline', { content, suggestedFilename }),
    inspectBase64: (value: string) => invoke('response-resources:inspect-base64', { value }),
    extractBase64: (historyId: string, jsonPath: string, value: string) =>
      invoke('response-resources:extract-base64', { historyId, jsonPath, value }),
  },
  websocket: {
    connect: (input: unknown) => invoke('websocket:connect', input),
    disconnect: (connectionId: string) => invoke('websocket:disconnect', { connectionId }),
    sendText: (connectionId: string, text: string) => invoke('websocket:send-text', { connectionId, text }),
    sendJson: (connectionId: string, text: string) => invoke('websocket:send-json', { connectionId, text }),
    sendBinary: (connectionId: string, base64: string) => invoke('websocket:send-binary', { connectionId, base64 }),
    sendFile: (connectionId: string, fileRef: string) => invoke('websocket:send-file', { connectionId, fileRef }),
  },
  sse: {
    connect: (input: unknown) => invoke('sse:connect', input),
    stop: (connectionId: string) => invoke('sse:stop', { connectionId }),
  },
  streaming: {
    onEvent: (listener: (payload: unknown) => void) => {
      const handler = (_event: unknown, payload: unknown) => listener(payload)
      ipcRenderer.on('streaming:event', handler)
      return () => ipcRenderer.removeListener('streaming:event', handler)
    },
  },
  streamHistory: {
    list: (input: unknown) => invoke('stream-history:list', input),
    get: (input: unknown) => invoke('stream-history:get', input),
    delete: (input: unknown) => invoke('stream-history:delete', input),
    clear: (input: unknown) => invoke('stream-history:clear', input),
  },
  streamTemplates: {
    list: (savedRequestId: string) => invoke('stream-templates:list', { savedRequestId }),
    save: (input: unknown) => invoke('stream-templates:save', input),
    delete: (id: string) => invoke('stream-templates:delete', { id }),
  },
})
