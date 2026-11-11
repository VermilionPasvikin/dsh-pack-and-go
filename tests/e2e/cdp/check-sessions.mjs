import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { scanFrames } from 'file:///F:/PersonalProjects/python/%E6%96%B0%E5%BB%BA%E6%96%87%E4%BB%B6%E5%A4%B9/src/core/index.js'

const dir = process.argv[2]
for (const project of fs.readdirSync(dir)) {
  const pdir = path.join(dir, project)
  if (!fs.statSync(pdir).isDirectory()) continue
  for (const sdir of fs.readdirSync(pdir)) {
    const sd = path.join(pdir, sdir)
    if (!fs.statSync(sd).isDirectory()) continue
    const file = path.join(sd, 'session.v4.jsonl.zstd')
    if (!fs.existsSync(file)) {
      console.log(project, sdir, 'NO-FILE')
      continue
    }
    const buf = fs.readFileSync(file)
    try {
      const frames = scanFrames(buf)
      const first = zlib
        .zstdDecompressSync(buf.subarray(frames[0].start, frames[0].end))
        .toString('utf8')
      const firstLine = first.split('\n')[0]
      const header = JSON.parse(firstLine)
      console.log(
        project,
        sdir,
        'frames=' + frames.length,
        'version=' + header.version,
        'id=' + header.id,
        'cwd=' + header.cwd,
      )
    } catch (error) {
      console.log(project, sdir, 'ERROR', error.message)
    }
  }
}
