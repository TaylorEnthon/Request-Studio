import { afterEach, describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sanitizeExportFilename, writeExportFileAtomic } from './request-export-file'

const roots: string[] = []
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'request-studio-export-'))
  const userData = join(root, 'user-data')
  mkdirSync(userData)
  roots.push(root)
  return { root, userData }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('request export file safety', () => {
  it('sanitizes traversal, invalid characters, reserved names, and empty names', () => {
    expect(sanitizeExportFilename('../../CON.sh')).toBe('_CON.sh')
    expect(sanitizeExportFilename('bad:<secret>.sh')).toBe('bad__secret_.sh')
    expect(sanitizeExportFilename('...')).toBe('request.txt')
    expect(sanitizeExportFilename(`safe-${'x'.repeat(200)}.json`)).toHaveLength(160)
  })

  it('writes through a sibling temporary file and leaves no temporary file', async () => {
    const { root, userData } = setup()
    const destination = join(root, 'request.sh')
    await writeExportFileAtomic(destination, 'safe-content', userData)
    expect(readFileSync(destination, 'utf8')).toBe('safe-content')
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('atomically writes iterable JSON chunks', async () => {
    const { root, userData } = setup()
    const destination = join(root, 'workspace.json')
    await writeExportFileAtomic(destination, ['{"format":', '"request-studio.workspace"}\n'], userData)
    expect(readFileSync(destination, 'utf8')).toBe('{"format":"request-studio.workspace"}\n')
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('rejects destinations inside userData', async () => {
    const { userData } = setup()
    await expect(
      writeExportFileAtomic(join(userData, 'blocked.sh'), 'safe-content', userData),
    ).rejects.toThrow('Export destination is not allowed.')
  })

  it('uses a fixed error and removes the temporary file after rename failure', async () => {
    const { root, userData } = setup()
    const destination = join(root, 'existing-directory')
    mkdirSync(destination)
    await expect(writeExportFileAtomic(destination, 'safe-content', userData)).rejects.toThrow(
      'Request export could not be saved.',
    )
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
