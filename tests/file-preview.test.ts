import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readWorkspacePreview } from '../src/runtime/file-preview.ts'

test('previews workspace text and images while rejecting paths and symlinks outside the workspace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meshwork-preview-'))
  const workspace = join(directory, 'workspace')
  const outside = join(directory, 'workspace-other')
  try {
    await Promise.all([mkdir(workspace), mkdir(outside)])
    const outsideFile = join(outside, 'secret.txt')
    const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1sAAAAASUVORK5CYII='
    await Promise.all([
      writeFile(join(workspace, 'notes.md'), '任务验收\n'),
      writeFile(join(workspace, 'long.txt'), `${'a'.repeat(256 * 1024 - 1)}续写`),
      writeFile(join(workspace, 'image.PNG'), Buffer.from(image, 'base64')),
      writeFile(join(workspace, 'binary.dat'), Buffer.from([0xff, 0, 0xff])),
      writeFile(outsideFile, 'outside'),
    ])
    assert.deepEqual(await readWorkspacePreview(workspace, 'notes.md'), { kind: 'text', text: '任务验收\n', truncated: false })
    assert.deepEqual(await readWorkspacePreview(workspace, 'image.PNG'), { kind: 'image', source: `data:image/png;base64,${image}` })
    const long = await readWorkspacePreview(workspace, join(workspace, 'long.txt'))
    assert.equal(long.kind, 'text')
    assert.equal(long.truncated, true)
    assert.equal(long.text.length, 256 * 1024 - 1)
    await assert.rejects(readWorkspacePreview(workspace, 'binary.dat'), /no preview/)
    await assert.rejects(readWorkspacePreview(workspace, '.'), /regular file/)
    await assert.rejects(readWorkspacePreview(workspace, '../workspace-other/secret.txt'), /inside the task workspace/)
    await symlink(outside, join(workspace, 'linked'), 'junction')
    await assert.rejects(readWorkspacePreview(workspace, 'linked/secret.txt'), /inside the task workspace/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
