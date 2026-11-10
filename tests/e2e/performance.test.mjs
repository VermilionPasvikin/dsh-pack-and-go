import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { scanWorkspace } from '../../src/core/scan.js'
import { planExport } from '../../src/core/plan-export.js'
import { buildManifest, buildPack } from '../../src/core/export-pack.js'

const MB = 1024 * 1024

test('100MB 工作区打包耗时与内存记录', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-perf-'))
  try {
    const project = join(dir, 'proj')
    await mkdir(project)
    const chunk = Buffer.alloc(MB, 0x61)
    const handle = await open(join(project, 'big.bin'), 'w')
    for (let index = 0; index < 100; index += 1) {
      await handle.write(chunk)
    }
    await handle.close()

    const scanStart = performance.now()
    const scan = await scanWorkspace(project)
    const scanMs = performance.now() - scanStart
    assert.equal(scan.files, 1)
    assert.equal(scan.totalBytes, 100 * MB)

    const files = scan.entries
      .filter((entry) => !entry.isDir)
      .map((entry) => ({ relPath: entry.relPath, size: entry.size }))
    const plan = planExport({
      workspaces: [{ key: 'w1', files }],
      includeFiles: true,
    })
    const manifest = buildManifest({
      platform: 'linux',
      dshVersion: 'perf',
      mode: 'workspaces',
      workspaces: [
        {
          key: 'w1',
          title: 'proj',
          sourcePath: project,
          sourcePlatform: 'linux',
          fileCount: files.length,
          sizeBytes: scan.totalBytes,
          root: 'workspaces/w1/files',
        },
      ],
    })
    const sourcePaths = { 'workspaces/w1/files/big.bin': join(project, 'big.bin') }

    const rssBefore = process.memoryUsage().rss
    const packStart = performance.now()
    const pack = await buildPack({ plan, sourcePaths, manifest })
    const packMs = performance.now() - packStart
    const rssAfter = process.memoryUsage().rss

    const metrics = {
      scanMs: Math.round(scanMs),
      packMs: Math.round(packMs),
      packBytes: pack.length,
      rssDeltaMB: Math.round(((rssAfter - rssBefore) / MB) * 10) / 10,
    }
    console.log(`DSH-MOVER-PERF ${JSON.stringify(metrics)}`)

    assert.ok(pack.length > 0)
    assert.ok(packMs < 60000, `packaging took ${packMs.toFixed(0)}ms`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
