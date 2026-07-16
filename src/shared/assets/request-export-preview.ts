import type { RequestAssetV1 } from './request-asset'
import type { SavedRequestAssetRow } from './request-asset-mapper'
import { createCurlExportPreview } from './curl-export'
import {
  mapSavedRequestToExportAsset,
  type ExportPreview,
  type ExportWarning,
} from './request-export'

export type RequestExportFormat = 'curl' | 'request-json'
export type RequestJsonExportPreview = Readonly<{
  format: 'request-json'
  protocol: RequestAssetV1['protocol']
  filenameSuggestion: string
  content: string
  warnings: readonly ExportWarning[]
}>
export type RequestExportPreview = ExportPreview | RequestJsonExportPreview

const filename = (name: string): string => {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `${stem || 'request'}.request-studio.json`
}

export function createRequestExportPreview(
  row: SavedRequestAssetRow,
  format: RequestExportFormat,
): RequestExportPreview {
  const asset = mapSavedRequestToExportAsset(row)
  if (format === 'curl') {
    if (asset.protocol !== 'http') throw new TypeError('cURL export supports HTTP requests only.')
    return createCurlExportPreview(asset)
  }
  return {
    format: 'request-json',
    protocol: asset.protocol,
    filenameSuggestion: filename(asset.name),
    content: `${JSON.stringify(asset, null, 2)}\n`,
    warnings: [],
  }
}
