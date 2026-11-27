import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { TaskFilePreview } from '../shared/workflow.ts'

const textLimit = 256 * 1024
const imageLimit = 8 * 1024 * 1024
const imageTypes = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.gif', 'image/gif'], ['.bmp', 'image/bmp'], ['.avif', 'image/avif'],
])

export async function readWorkspacePreview(workspace: string, path: string): Promise<TaskFilePreview> {
  const [root, target] = await Promise.all([
    realpath(workspace), realpath(resolve(workspace, path)),
  ]).catch(() => { throw new Error('The file or its workspace could not be found.') })
  const relativePath = relative(root, target)
  if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error('Only files inside the task workspace can be previewed.')
  }

  const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => {
    throw new Error('The file could not be opened.')
  })
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('Choose a regular file to preview.')
    const mime = imageTypes.get(extname(target).toLowerCase())
    if (mime && info.size > imageLimit) throw new Error('This image exceeds the 8 MB preview limit.')

    const limit = mime ? info.size : Math.min(info.size, textLimit)
    const buffer = Buffer.alloc(limit)
    let length = 0
    while (length < limit) {
      const { bytesRead } = await file.read(buffer, length, limit - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    const bytes = buffer.subarray(0, length)
    if (mime) return { kind: 'image', source: `data:${mime};base64,${bytes.toString('base64')}` }

    const truncated = info.size > textLimit && length === textLimit
    const bom = bytes.length >= 2 ? bytes.readUInt16BE(0) : 0
    try {
      const encoding = bom === 0xFFFE ? 'utf-16le' : bom === 0xFEFF ? 'utf-16be' : 'utf-8'
      const text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: truncated })
      if (!text.includes('\0')) return { kind: 'text', text, truncated }
    } catch {
      // Non-text files are handled by the unsupported-format message below.
    }
    throw new Error('This file format has no preview. Text files and common images are supported.')
  } finally {
    await file.close()
  }
}
