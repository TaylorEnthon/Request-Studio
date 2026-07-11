import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, input?: unknown) => ipcRenderer.invoke(channel, input)
contextBridge.exposeInMainWorld('requestStudio', {
  workspaces: { list: () => invoke('workspaces:list'), create: (input: unknown) => invoke('workspaces:create', input), rename: (input: unknown) => invoke('workspaces:rename', input), delete: (input: unknown) => invoke('workspaces:delete', input), select: (input: unknown) => invoke('workspaces:select', input) },
  collections: { list: (workspaceId: string) => invoke('collections:list', { workspaceId }), create: (input: unknown) => invoke('collections:create', input), rename: (input: unknown) => invoke('collections:rename', input), delete: (input: unknown) => invoke('collections:delete', input) },
  environments: { list: (workspaceId: string) => invoke('environments:list', { workspaceId }), create: (input: unknown) => invoke('environments:create', input), rename: (input: unknown) => invoke('environments:rename', input), delete: (input: unknown) => invoke('environments:delete', input), getSelected: (workspaceId:string) => invoke('environments:selected:get',{workspaceId}), select: (workspaceId:string,environmentId:string|null) => invoke('environments:selected:set',{workspaceId,environmentId}) },
  variables: { list: (environmentId: string) => invoke('variables:list', { environmentId }), create: (input: unknown) => invoke('variables:create', input), update: (input: unknown) => invoke('variables:update', input), delete: (input: unknown) => invoke('variables:delete', input) },
  savedRequests: { list: (workspaceId: string) => invoke('requests:list', { workspaceId }), create: (input: unknown) => invoke('requests:create', input), update: (input: unknown) => invoke('requests:update', input), delete: (input: unknown) => invoke('requests:delete', input), duplicate: (input: unknown) => invoke('requests:duplicate', input) }
})
