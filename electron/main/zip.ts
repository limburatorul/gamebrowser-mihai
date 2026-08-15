import { promises as fs, createWriteStream } from 'fs'
import { join, dirname, extname } from 'path'
import * as zlib from 'zlib'
import type { Writable } from 'stream'
import { writeFileAtomic } from './fsAtomic'

const { deflateRawSync, inflateRawSync } = zlib

interface ZipFileEntry {
  zipPath: string
  fsPath: string
}

interface ZipSource {
  zipPath: string
  fsPath: string
  isDir?: boolean
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_ZIP64_LOCATOR = 0x07064b50

const METHOD_STORE = 0
const METHOD_DEFLATE = 8

// 0xffffffff is the "look in the Zip64 extra field" sentinel, so any real value
// that large has to move to Zip64 regardless.
const U32_MAX = 0xffffffff
const U16_MAX = 0xffff

// Deflating an already-compressed format burns CPU over the whole archive to
// save nothing - the old code did it and then threw the result away via the
// store fallback. With a userData folder that is ~96% cached JPEG screenshots,
// skipping the attempt is most of the backup's runtime.
const PRECOMPRESSED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.zip'])

// zlib.crc32 (native, ~an order of magnitude faster than the JS loop over
// gigabytes) landed in Node 20.15. Electron 31 ships a newer 20.x, but feature
// detect rather than assume - the fallback is a few lines.
const nativeCrc32 = (zlib as { crc32?: (data: Buffer, value?: number) => number }).crc32

const CRC_TABLE = buildCrcTable()

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
}

function crc32(buf: Buffer): number {
  if (nativeCrc32) return nativeCrc32(buf, 0) >>> 0
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function toDosTime(d: Date): number {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff
}

function toDosDate(d: Date): number {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
}

async function collectFiles(dir: string, zipPrefix: string): Promise<ZipFileEntry[]> {
  const out: ZipFileEntry[] = []
  async function walk(current: string, prefix: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fsPath = join(current, entry.name)
      const zipPath = `${prefix}/${entry.name}`
      if (entry.isDirectory()) await walk(fsPath, zipPath)
      else if (entry.isFile()) out.push({ zipPath, fsPath })
    }
  }
  await walk(dir, zipPrefix)
  return out
}

// Write one chunk, respecting backpressure. Without the drain wait the stream
// queues everything in memory and we are right back to the allocation failure
// this whole rewrite exists to fix.
function writeChunk(out: Writable, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (out.write(buf)) {
      resolve()
      return
    }
    const onDrain = (): void => {
      out.off('error', onError)
      resolve()
    }
    const onError = (err: Error): void => {
      out.off('drain', onDrain)
      reject(err)
    }
    out.once('drain', onDrain)
    out.once('error', onError)
  })
}

function closeStream(out: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    out.once('error', reject)
    out.end(() => resolve())
  })
}

/**
 * Minimal self-contained ZIP writer (no bundled tar/zip dependency - this app
 * avoids new npm deps given how flaky installs are in this environment; see
 * project notes).
 *
 * Streams straight to disk: peak memory is one file, not the whole archive.
 * The previous version accumulated every compressed payload in an array and
 * then `Buffer.concat`ed the lot, which needed roughly twice the archive size
 * contiguously and died with "Array buffer allocation failed" once the
 * screenshot cache pushed a backup past ~3GB.
 *
 * Zip64 is emitted only where a field actually overflows, so archives that fit
 * in the classic format stay byte-for-byte ordinary and readable anywhere.
 */
export async function createZip(
  items: ZipSource[],
  outputZipPath: string,
  onProgress?: (done: number, total: number, currentName: string) => void
): Promise<void> {
  const files: ZipFileEntry[] = []
  for (const item of items) {
    if (item.isDir) {
      files.push(...(await collectFiles(item.fsPath, item.zipPath)))
    } else {
      try {
        await fs.access(item.fsPath)
        files.push({ zipPath: item.zipPath, fsPath: item.fsPath })
      } catch {
        // optional source file doesn't exist yet - skip it
      }
    }
  }

  // Build into a .part and rename at the end, so a failure part-way through
  // never leaves something that looks like a usable backup in the folder.
  const partPath = `${outputZipPath}.part`
  const out = createWriteStream(partPath)
  await new Promise<void>((resolve, reject) => {
    out.once('open', () => resolve())
    out.once('error', reject)
  })

  const central: Buffer[] = []
  let offset = 0
  let written = 0
  const now = new Date()
  const dosTime = toDosTime(now)
  const dosDate = toDosDate(now)

  try {
    let seen = 0
    for (const file of files) {
      // Reported before the work, so the name shown is the one being handled.
      onProgress?.(seen, files.length, file.zipPath)
      seen++
      let data: Buffer
      try {
        data = await fs.readFile(file.fsPath)
      } catch (e) {
        // The screenshot sweep runs on a timer and can delete/replace a file
        // mid-backup. Something that no longer exists can't be archived, and
        // failing the entire backup over it would be worse. Any other error
        // (permissions, IO) is real and propagates.
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw e
      }

      const crc = crc32(data)
      const skipDeflate = PRECOMPRESSED.has(extname(file.fsPath).toLowerCase())
      const deflated = skipDeflate ? null : deflateRawSync(data, { level: 9 })
      const useStore = deflated === null || deflated.length >= data.length
      const method = useStore ? METHOD_STORE : METHOD_DEFLATE
      const payload = useStore ? data : (deflated as Buffer)
      const nameBuf = Buffer.from(file.zipPath, 'utf-8')

      // Individual files here are images and small JSON, so per-entry sizes
      // never approach 4GB - only the running offset does. That keeps the
      // local headers plain; Zip64 is a central-directory concern below.
      const localHeader = Buffer.alloc(30)
      localHeader.writeUInt32LE(SIG_LOCAL, 0)
      localHeader.writeUInt16LE(20, 4)
      localHeader.writeUInt16LE(0x0800, 6)
      localHeader.writeUInt16LE(method, 8)
      localHeader.writeUInt16LE(dosTime, 10)
      localHeader.writeUInt16LE(dosDate, 12)
      localHeader.writeUInt32LE(crc, 14)
      localHeader.writeUInt32LE(payload.length, 18)
      localHeader.writeUInt32LE(data.length, 22)
      localHeader.writeUInt16LE(nameBuf.length, 26)
      localHeader.writeUInt16LE(0, 28)

      await writeChunk(out, localHeader)
      await writeChunk(out, nameBuf)
      if (payload.length > 0) await writeChunk(out, payload)

      const needsZip64 = offset > U32_MAX
      const extraBuf = needsZip64 ? Buffer.alloc(12) : Buffer.alloc(0)
      if (needsZip64) {
        extraBuf.writeUInt16LE(0x0001, 0)
        extraBuf.writeUInt16LE(8, 2)
        extraBuf.writeBigUInt64LE(BigInt(offset), 4)
      }

      const centralHeader = Buffer.alloc(46)
      centralHeader.writeUInt32LE(SIG_CENTRAL, 0)
      centralHeader.writeUInt16LE(needsZip64 ? 45 : 20, 4)
      centralHeader.writeUInt16LE(needsZip64 ? 45 : 20, 6)
      centralHeader.writeUInt16LE(0x0800, 8)
      centralHeader.writeUInt16LE(method, 10)
      centralHeader.writeUInt16LE(dosTime, 12)
      centralHeader.writeUInt16LE(dosDate, 14)
      centralHeader.writeUInt32LE(crc, 16)
      centralHeader.writeUInt32LE(payload.length, 20)
      centralHeader.writeUInt32LE(data.length, 24)
      centralHeader.writeUInt16LE(nameBuf.length, 28)
      centralHeader.writeUInt16LE(extraBuf.length, 30)
      centralHeader.writeUInt16LE(0, 32)
      centralHeader.writeUInt16LE(0, 34)
      centralHeader.writeUInt16LE(0, 36)
      centralHeader.writeUInt32LE(0, 38)
      centralHeader.writeUInt32LE(needsZip64 ? U32_MAX : offset, 42)
      central.push(centralHeader, nameBuf, extraBuf)

      offset += localHeader.length + nameBuf.length + payload.length
      written++
    }

    onProgress?.(files.length, files.length, '')

    const centralStart = offset
    let centralSize = 0
    for (const chunk of central) {
      await writeChunk(out, chunk)
      centralSize += chunk.length
    }

    const needsZip64End = written > U16_MAX || centralSize > U32_MAX || centralStart > U32_MAX
    if (needsZip64End) {
      const z64 = Buffer.alloc(56)
      z64.writeUInt32LE(SIG_ZIP64_EOCD, 0)
      z64.writeBigUInt64LE(BigInt(44), 4) // size of the rest of this record
      z64.writeUInt16LE(45, 12)
      z64.writeUInt16LE(45, 14)
      z64.writeUInt32LE(0, 16)
      z64.writeUInt32LE(0, 20)
      z64.writeBigUInt64LE(BigInt(written), 24)
      z64.writeBigUInt64LE(BigInt(written), 32)
      z64.writeBigUInt64LE(BigInt(centralSize), 40)
      z64.writeBigUInt64LE(BigInt(centralStart), 48)
      await writeChunk(out, z64)

      const locator = Buffer.alloc(20)
      locator.writeUInt32LE(SIG_ZIP64_LOCATOR, 0)
      locator.writeUInt32LE(0, 4)
      locator.writeBigUInt64LE(BigInt(centralStart + centralSize), 8)
      locator.writeUInt32LE(1, 16)
      await writeChunk(out, locator)
    }

    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(SIG_EOCD, 0)
    eocd.writeUInt16LE(0, 4)
    eocd.writeUInt16LE(0, 6)
    eocd.writeUInt16LE(Math.min(written, U16_MAX), 8)
    eocd.writeUInt16LE(Math.min(written, U16_MAX), 10)
    eocd.writeUInt32LE(Math.min(centralSize, U32_MAX), 12)
    eocd.writeUInt32LE(Math.min(centralStart, U32_MAX), 16)
    eocd.writeUInt16LE(0, 20)
    await writeChunk(out, eocd)

    await closeStream(out)
  } catch (e) {
    out.destroy()
    await fs.rm(partPath, { force: true }).catch(() => undefined)
    throw e
  }

  await fs.rename(partPath, outputZipPath)
}

function findEocd(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

async function readAt(fh: fs.FileHandle, length: number, position: number): Promise<Buffer> {
  const buf = Buffer.alloc(length)
  if (length === 0) return buf
  const { bytesRead } = await fh.read(buf, 0, length, position)
  if (bytesRead !== length) throw new Error('Corrupt backup archive (unexpected end of file).')
  return buf
}

/**
 * Reads entries one at a time straight off the file handle. Deliberately never
 * loads the whole archive - restoring a multi-gigabyte backup would hit the
 * same allocation ceiling that writing one used to.
 */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const fh = await fs.open(zipPath, 'r')
  try {
    const { size } = await fh.stat()
    // The EOCD sits within 22 bytes + a comment of at most 64KB of the end.
    const tailLen = Math.min(size, 22 + U16_MAX)
    const tail = await readAt(fh, tailLen, size - tailLen)
    const eocdOffset = findEocd(tail)
    if (eocdOffset === -1) throw new Error('Not a valid backup archive (no end-of-central-directory record found).')

    let entryCount = tail.readUInt16LE(eocdOffset + 10)
    let centralSize = tail.readUInt32LE(eocdOffset + 12)
    let centralStart = tail.readUInt32LE(eocdOffset + 16)

    // A Zip64 locator, when present, sits immediately before the EOCD.
    const locatorOffset = eocdOffset - 20
    if (locatorOffset >= 0 && tail.readUInt32LE(locatorOffset) === SIG_ZIP64_LOCATOR) {
      const z64Offset = Number(tail.readBigUInt64LE(locatorOffset + 8))
      const z64 = await readAt(fh, 56, z64Offset)
      if (z64.readUInt32LE(0) === SIG_ZIP64_EOCD) {
        entryCount = Number(z64.readBigUInt64LE(32))
        centralSize = Number(z64.readBigUInt64LE(40))
        centralStart = Number(z64.readBigUInt64LE(48))
      }
    }

    // The central directory itself is small even for a huge archive - roughly
    // 70 bytes per entry, so a few hundred KB for thousands of screenshots.
    const central = await readAt(fh, centralSize, centralStart)

    let ptr = 0
    for (let i = 0; i < entryCount; i++) {
      if (ptr + 46 > central.length || central.readUInt32LE(ptr) !== SIG_CENTRAL) {
        throw new Error('Corrupt backup archive (bad central directory).')
      }
      const method = central.readUInt16LE(ptr + 10)
      let uncompressedSize = central.readUInt32LE(ptr + 24)
      let compressedSize = central.readUInt32LE(ptr + 20)
      const nameLen = central.readUInt16LE(ptr + 28)
      const extraLen = central.readUInt16LE(ptr + 30)
      const commentLen = central.readUInt16LE(ptr + 32)
      let localOffset = central.readUInt32LE(ptr + 42)
      const name = central.toString('utf-8', ptr + 46, ptr + 46 + nameLen)

      // Zip64 extra field: the 64-bit values appear in a fixed order, but only
      // for those base fields actually set to the 0xffffffff sentinel.
      if (uncompressedSize === U32_MAX || compressedSize === U32_MAX || localOffset === U32_MAX) {
        const extraStart = ptr + 46 + nameLen
        let e = extraStart
        while (e + 4 <= extraStart + extraLen) {
          const fieldId = central.readUInt16LE(e)
          const fieldLen = central.readUInt16LE(e + 2)
          if (fieldId === 0x0001) {
            let f = e + 4
            if (uncompressedSize === U32_MAX) {
              uncompressedSize = Number(central.readBigUInt64LE(f))
              f += 8
            }
            if (compressedSize === U32_MAX) {
              compressedSize = Number(central.readBigUInt64LE(f))
              f += 8
            }
            if (localOffset === U32_MAX) localOffset = Number(central.readBigUInt64LE(f))
            break
          }
          e += 4 + fieldLen
        }
      }

      const normalized = name.replace(/\\/g, '/')
      if (normalized.includes('..') || normalized.startsWith('/')) {
        throw new Error(`Refusing to extract unsafe path in backup archive: ${name}`)
      }

      const localHeader = await readAt(fh, 30, localOffset)
      const localNameLen = localHeader.readUInt16LE(26)
      const localExtraLen = localHeader.readUInt16LE(28)
      const dataStart = localOffset + 30 + localNameLen + localExtraLen
      const compressed = await readAt(fh, compressedSize, dataStart)
      const data = method === METHOD_DEFLATE ? inflateRawSync(compressed) : compressed

      const destPath = join(destDir, normalized)
      await fs.mkdir(dirname(destPath), { recursive: true })
      await writeFileAtomic(destPath, data)

      ptr += 46 + nameLen + extraLen + commentLen
    }
  } finally {
    await fh.close()
  }
}
