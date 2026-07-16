import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export const sanitizeExportFilename = (value: string): string => {
  let name = [...basename(value)]
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character,
    )
    .join('')
    .replace(/[. ]+$/, '')
    .slice(0, 160) || 'request.txt'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = `_${name}`
  return name
}

export async function writeExportFileAtomic(
  destination: string,
  content: string,
  userData: string,
): Promise<void> {
  const output = resolve(destination)
  const restricted = resolve(userData)
  const relation = relative(restricted.toLowerCase(), output.toLowerCase())
  if (!relation || (!relation.startsWith('..') && !isAbsolute(relation))) {
    throw new Error('Export destination is not allowed.')
  }

  const temporary = join(dirname(output), `.${basename(output)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, output)
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw new Error('Request export could not be saved.')
  }
}
