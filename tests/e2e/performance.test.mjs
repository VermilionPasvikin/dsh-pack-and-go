import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, truncate, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { scanWorkspace } from '../../src/core/scan.js'
import { planExport } from '../../src/core/plan-export.js'
import { buildManifest, buildPackToFile } from '../../src/core/export-pack.js'

const MB = 1024 * 1024

test('500MB 工作区流式打包：耗时与内存记录（NFR-2）', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mover-perf-'))
  try {
    const project = join(dir, 'proj')
    await mkdir(project)
    const big = join(project, 'big.bin')
    await writeFile(big, '')
    await truncate(big, 500 * MB)
    assert.equal((await stat(big)).size, 500 * MB)

    const scanStart = performance.now()
    const scan = await scanWorkspace(project)
    const scanMs = performance.now() - scanStart

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
    const sourcePaths = { 'workspaces/w1/files/big.bin': big }
    const outputPath = join(dir, 'pack.dshpack')

    let peakRss = process.memoryUsage().rss
    const timer = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss)
    }, 50)

    const packStart = performance.now()
    const result = await buildPackToFile({ plan, sourcePaths, manifest, outputPath })
    const packMs = performance.now() - packStart
    clearInterval(timer)

    const rssBefore = peakRss
    const metrics = {
      scanMs: Math.round(scanMs),
      packMs: Math.round(packMs),
      packBytes: result.bytes,
      peakRssMB: Math.round((rssBefore / MB) * 10) / 10,
    }
    console.log(`DSH-MOVER-PERF-500 ${JSON.stringify(metrics)}`)

    assert.equal(result.entries, 3) // manifest + README + big.bin
    assert.ok(packMs < 60000, `packaging took ${packMs.toFixed(0)}ms`)
    assert.ok(result.bytes > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
