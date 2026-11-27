import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  parseAttachmentId,
  imageObjectPath,
  fileObjectPath,
  fileReferencePath,
  packAttachmentPath,
  extractAttachmentRefs,
  restoreAttachments,
  PACK_ATTACHMENTS_ROOT,
} from '../../src/core/attachments.js'
import { ERROR_CODES, MoverError } from '../../src/core/errors.js'

const IMAGE_ID = `sha256:${'a'.repeat(64)}`
const FILE_ID = `sha256:${'b'.repeat(64)}`

function makeSessionWithAttachments() {
  const events = [
    {
      type: 'session',
      version: 4,
      id: 's1',
      createdAt: 1700000000000,
      isSeeded: false,
      delegationDepth: 0,
      cwd: '/p',
    },
    {
      type: 'user/message',
      seq: 0,
      time: 1,
      data: {
        message: {
          role: 'user',
          content: [
            { type: 'text', text: '看这个' },
            {
              type: 'image',
              attachment: {
                attachmentId: IMAGE_ID,
                mediaType: 'image/png',
                bytes: 3,
                width: 1,
                height: 1,
              },
            },
            {
              type: 'file',
              attachment: { attachmentId: FILE_ID, name: 'a.txt', bytes: 5 },
            },
            // 重复引用应去重
            {
              type: 'image',
              attachment: {
                attachmentId: IMAGE_ID,
                mediaType: 'image/png',
                bytes: 3,
                width: 1,
                height: 1,
              },
            },
          ],
        },
      },
    },
  ]
  return Buffer.concat(
    events.map((event) => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(event)}\n`))),
  )
}

test('parseAttachmentId 校验 sha256 形式', () => {
  assert.deepEqual(parseAttachmentId(IMAGE_ID), { digest: 'a'.repeat(64) })
  assert.throws(
    () => parseAttachmentId('not-a-sha256'),
    (error) => error instanceof MoverError && error.code === ERROR_CODES.PACK_INVALID,
  )
})

test('附件路径按 digest 前缀分桶', () => {
  const root = '/attachments/v1'
  assert.equal(imageObjectPath(root, IMAGE_ID), join(root, 'objects', 'aa', 'a'.repeat(64)))
  assert.equal(fileObjectPath(root, FILE_ID), join(root, 'file-objects', 'bb', 'b'.repeat(64)))
  assert.equal(
    fileReferencePath(root, FILE_ID, 'a.txt'),
    join(root, 'files', 'bb', 'b'.repeat(64), 'a.txt'),
  )
  assert.equal(
    packAttachmentPath('image', IMAGE_ID),
    `${PACK_ATTACHMENTS_ROOT}/objects/aa/${'a'.repeat(64)}`,
  )
  assert.equal(
    packAttachmentPath('file-reference', FILE_ID, 'a.txt'),
    `${PACK_ATTACHMENTS_ROOT}/files/bb/${'b'.repeat(64)}/a.txt`,
  )
})

test('从会话事件提取附件引用并去重', () => {
  const refs = extractAttachmentRefs(makeSessionWithAttachments())
  assert.equal(refs.length, 2)
  const image = refs.find((ref) => ref.attachmentId === IMAGE_ID)
  const file = refs.find((ref) => ref.attachmentId === FILE_ID)
  assert.equal(image.kind, 'image')
  assert.equal(file.kind, 'file')
  assert.equal(file.name, 'a.txt')
})

test('restore 附件往返（按包内路径写回）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pack-and-go-attach-'))
  try {
    const sourceRoot = join(dir, 'src-attachments')
    const targetRoot = join(dir, 'dst-attachments')

    const imagePath = imageObjectPath(sourceRoot, IMAGE_ID)
    await mkdir(dirname(imagePath), { recursive: true })
    await writeFile(imagePath, Buffer.from('img-bytes'))

    const objectPath = fileObjectPath(sourceRoot, FILE_ID)
    await mkdir(dirname(objectPath), { recursive: true })
    await writeFile(objectPath, Buffer.from('file-bytes'))

    const referencePath = fileReferencePath(sourceRoot, FILE_ID, 'a.txt')
    await mkdir(dirname(referencePath), { recursive: true })
    await writeFile(referencePath, Buffer.from('file-bytes'))

    const entries = [
      {
        packPath: packAttachmentPath('image', IMAGE_ID),
        data: await readFile(imagePath),
      },
      {
        packPath: packAttachmentPath('file-object', FILE_ID),
        data: await readFile(objectPath),
      },
      {
        packPath: packAttachmentPath('file-reference', FILE_ID, 'a.txt'),
        data: await readFile(referencePath),
      },
    ]
    const restored = await restoreAttachments({ entries, attachmentsRoot: targetRoot })
    assert.equal(restored.restored, entries.length)
    assert.equal(restored.warnings.length, 0)

    assert.equal((await readFile(imageObjectPath(targetRoot, IMAGE_ID))).toString(), 'img-bytes')
    assert.equal((await readFile(fileObjectPath(targetRoot, FILE_ID))).toString(), 'file-bytes')
    assert.equal(
      (await readFile(fileReferencePath(targetRoot, FILE_ID, 'a.txt'))).toString(),
      'file-bytes',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
