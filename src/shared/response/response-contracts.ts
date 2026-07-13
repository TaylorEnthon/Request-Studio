export type ResponseBodyKind =
  'empty' | 'json' | 'text' | 'html' | 'xml' | 'image' | 'audio' | 'video' | 'pdf' | 'binary'
export type ClassificationSource = 'declared' | 'signature' | 'sniffed' | 'fallback'
export interface ResponseClassification {
  kind: ResponseBodyKind
  declaredMimeType: string | null
  detectedMimeType: string | null
  effectiveMimeType: string | null
  source: ClassificationSource
  warnings: string[]
}
export interface ResponseResourceDescriptor {
  id: string
  historyId: string
  source: 'managed-response-file' | 'base64-extraction' | 'stream-record'
  kind: Exclude<ResponseBodyKind, 'empty' | 'json' | 'text' | 'html' | 'xml'>
  declaredMimeType: string | null
  detectedMimeType: string | null
  effectiveMimeType: string | null
  byteLength: number
  suggestedFilename: string
  warnings: string[]
  storageMode: 'managed-resource'
}
