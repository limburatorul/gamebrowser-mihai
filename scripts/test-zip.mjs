/**
 * Tests for electron/main/zip.ts - the hand-rolled backup archive reader and
 * writer. Run with `npm run test:zip`, or `npm run test:zip -- --zip64` to also
 * build a real >4GB archive (slow, needs ~10GB of scratch space).
 *
 * There is no test framework here on purpose: this project avoids adding npm
 * dependencies because installs are unreliable in its environment. esbuild is
 * already present (vite and electron-vite both depend on it) and is used to
 * bundle the real module, so these tests run against production code rather
 * than a copy of it.
 *
 * Why this exists: the writer emits Zip64 by hand. A regression there produces
 * archives that still look fine and still read back through our own reader,
 * while being unreadable by anything else - or worse, silently truncated. Two
 * of the checks below deliberately validate with a foreign reader instead.
 */
import { build } from 'esbuild'
import { promises as fs, createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash, randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = join(tmpdir(), `gb-zip-tests-${process.pid}`)
const wantZip64 = process.argv.includes('--zip64')

let failures = 0
let passes = 0

function check(name, condition, detail = '') {
  if (condition) {
    passes++
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

async function hashTree(dir) {
  const map = new Map()
  async function walk(d, prefix) {
    let entries
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) await walk(p, rel)
      else map.set(rel, createHash('sha256').update(await fs.readFile(p)).digest('hex'))
    }
  }
  await walk(dir, '')
  return map
}

const exists = (p) => fs.access(p).then(() => true, () => false)

// ---------------------------------------------------------------- setup ----

await fs.rm(scratch, { recursive: true, force: true })
await fs.mkdir(scratch, { recursive: true })

const bundlePath = join(scratch, 'zip.mjs')
await build({
  entryPoints: [join(repoRoot, 'electron/main/zip.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundlePath,
  logLevel: 'silent'
})
const { createZip, extractZip } = await import(pathToFileURL(bundlePath).href)

// ------------------------------------------------- 1. round trip, mixed ----

console.log('\nround trip with a mixed tree')
{
  const src = join(scratch, 'rt-src')
  const out = join(scratch, 'rt.zip')
  const dest = join(scratch, 'rt-out')
  await fs.mkdir(join(src, 'covers'), { recursive: true })
  await fs.mkdir(join(src, 'screenshots', 'nested'), { recursive: true })

  // highly compressible, so the deflate path is exercised too
  await fs.writeFile(join(src, 'library.json'), JSON.stringify({ games: Array(500).fill({ name: 'x'.repeat(40) }) }))
  await fs.writeFile(join(src, 'empty.json'), '')
  await fs.writeFile(join(src, 'covers', 'ünïcode nàme.jpg'), randomBytes(50_000))
  for (let i = 0; i < 20; i++) {
    await fs.writeFile(join(src, 'covers', `c${i}.png`), randomBytes(20_000))
    await fs.writeFile(join(src, 'screenshots', `s${i}.jpg`), randomBytes(30_000))
  }
  await fs.writeFile(join(src, 'screenshots', 'nested', 'deep.jpg'), randomBytes(10_000))

  const before = await hashTree(src)
  await createZip(
    [
      { zipPath: 'library.json', fsPath: join(src, 'library.json') },
      { zipPath: 'empty.json', fsPath: join(src, 'empty.json') },
      { zipPath: 'absent.json', fsPath: join(src, 'not-here.json') },
      { zipPath: 'covers', fsPath: join(src, 'covers'), isDir: true },
      { zipPath: 'screenshots', fsPath: join(src, 'screenshots'), isDir: true }
    ],
    out
  )

  check('missing optional source is skipped, not fatal', await exists(out))
  check('no .part left behind on success', !(await exists(`${out}.part`)))

  await extractZip(out, dest)
  const after = await hashTree(dest)

  let identical = before.size > 0 && before.size === after.size
  for (const [name, hash] of before) if (after.get(name) !== hash) identical = false
  check(`every file round-trips byte-for-byte (${before.size} files)`, identical)
  check('nested directories are preserved', after.has('screenshots/nested/deep.jpg'))
  check('unicode filenames survive', after.has('covers/ünïcode nàme.jpg'))
  check('empty files survive', after.get('empty.json') === before.get('empty.json'))
}

// ------------------------------------------- 2. progress callback shape ----

console.log('\nprogress reporting')
{
  const src = join(scratch, 'pg-src')
  await fs.mkdir(src, { recursive: true })
  for (let i = 0; i < 5; i++) await fs.writeFile(join(src, `f${i}.txt`), `file ${i}`)

  const seen = []
  await createZip([{ zipPath: 'f', fsPath: src, isDir: true }], join(scratch, 'pg.zip'), (done, total, name) =>
    seen.push({ done, total, name })
  )
  check('reports once per file plus a final tick', seen.length === 6, `got ${seen.length}`)
  check('totals are stable', seen.every((s) => s.total === 5))
  check('counter ends at the total', seen[seen.length - 1].done === 5)
}

// ------------------------------------------------- 3. failure behaviour ----

console.log('\nfailure handling')
{
  const src = join(scratch, 'fail-src')
  await fs.mkdir(join(src, 'a-directory'), { recursive: true })
  await fs.writeFile(join(src, 'fine.txt'), 'ok')
  const out = join(scratch, 'fail.zip')

  // a directory declared as a plain file: access() succeeds, readFile fails
  let threw = false
  try {
    await createZip(
      [
        { zipPath: 'fine.txt', fsPath: join(src, 'fine.txt') },
        { zipPath: 'boom', fsPath: join(src, 'a-directory') }
      ],
      out
    )
  } catch {
    threw = true
  }
  check('a real read error fails the backup', threw)
  check('failed run leaves no .part', !(await exists(`${out}.part`)))
  check('failed run leaves no half-written archive', !(await exists(out)))
}

// --------------------------------------------------- 4. zip-slip guard -----

console.log('\npath traversal guard')
{
  const src = join(scratch, 'slip-src')
  await fs.mkdir(src, { recursive: true })
  await fs.writeFile(join(src, 'evil.txt'), 'should never be written outside the destination')
  const out = join(scratch, 'slip.zip')
  await createZip([{ zipPath: '../evil.txt', fsPath: join(src, 'evil.txt') }], out)

  let refused = false
  try {
    await extractZip(out, join(scratch, 'slip-out'))
  } catch (e) {
    refused = /unsafe path/i.test(String(e))
  }
  check('extract refuses entries that escape the destination', refused)
}

// ------------------------------------ 5. foreign reader cross-validation ----

console.log('\nvalidation by a reader that is not ours')
{
  const out = join(scratch, 'rt.zip')
  if (process.platform === 'win32') {
    const ps = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      `$z=[System.IO.Compression.ZipFile]::OpenRead('${out}');`,
      '$n=$z.Entries.Count;',
      // decompress every entry so a bad CRC or bad offset actually surfaces
      '$bytes=0; foreach($e in $z.Entries){$s=$e.Open();$m=New-Object System.IO.MemoryStream;$s.CopyTo($m);$bytes+=$m.Length;$s.Dispose();$m.Dispose()};',
      '$z.Dispose(); Write-Output "$n $bytes"'
    ].join(' ')
    try {
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        maxBuffer: 1024 * 1024
      })
      const [count, bytes] = stdout.trim().split(/\s+/).map(Number)
      check('.NET ZipFile reads the archive', count > 0, stdout.trim())
      check('.NET decompresses every entry without error', bytes > 0)
    } catch (e) {
      check('.NET ZipFile reads the archive', false, String(e).slice(0, 200))
    }
  } else {
    console.log('  skip (Windows-only check)')
  }
}

// ----------------------------------------------------------- 6. zip64 ------

if (wantZip64) {
  console.log('\nzip64 (>4GB archive)')
  const src = join(scratch, 'big-src')
  const out = join(scratch, 'big.zip')
  const dest = join(scratch, 'big-out')
  await fs.mkdir(src, { recursive: true })

  const FILE_COUNT = 7
  const FILE_SIZE = 700 * 1024 * 1024 // 4.9GB total, so the last entry starts past 4GB
  const CHUNK = 64 * 1024 * 1024
  const hashes = new Map()

  for (let i = 0; i < FILE_COUNT; i++) {
    const name = `blob${i}.jpg` // .jpg so it is STOREd, not pointlessly deflated
    const chunk = Buffer.alloc(CHUNK)
    chunk.write(`file-${i}-marker`, 0)
    const ws = createWriteStream(join(src, name))
    const hash = createHash('sha256')
    for (let left = FILE_SIZE; left > 0; ) {
      const n = Math.min(CHUNK, left)
      hash.update(chunk.subarray(0, n))
      if (!ws.write(chunk.subarray(0, n))) await new Promise((r) => ws.once('drain', r))
      left -= n
    }
    await new Promise((r) => ws.end(r))
    hashes.set(name, hash.digest('hex'))
  }

  await createZip([{ zipPath: 'screenshots', fsPath: src, isDir: true }], out)
  const size = (await fs.stat(out)).size
  check('archive exceeds the 4GB classic-zip ceiling', size > 0xffffffff, `${size} bytes`)

  const fh = await fs.open(out, 'r')
  const tail = Buffer.alloc(98)
  await fh.read(tail, 0, 98, size - 98)
  await fh.close()
  check('Zip64 end-of-central-directory locator present', tail.readUInt32LE(tail.length - 42) === 0x07064b50)
  check('classic EOCD carries the overflow sentinel', tail.readUInt32LE(tail.length - 6) === 0xffffffff)

  await extractZip(out, dest)
  let allMatch = true
  for (const [name, want] of hashes) {
    const hash = createHash('sha256')
    const f = await fs.open(join(dest, 'screenshots', name), 'r')
    const buf = Buffer.alloc(CHUNK)
    for (let pos = 0; ; ) {
      const { bytesRead } = await f.read(buf, 0, CHUNK, pos)
      if (bytesRead === 0) break
      hash.update(buf.subarray(0, bytesRead))
      pos += bytesRead
    }
    await f.close()
    if (hash.digest('hex') !== want) allMatch = false
  }
  check('every entry round-trips past the 4GB boundary', allMatch)
} else {
  console.log('\nzip64: skipped (pass --zip64 to run it, ~10GB scratch space)')
}

// ---------------------------------------------------------------- done -----

await fs.rm(scratch, { recursive: true, force: true })
console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures === 0 ? 0 : 1)
