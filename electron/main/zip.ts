import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { deflateRawSync, inflateRawSync } from 'zlib'
import { writeFileAtomic } from './fsAtomic'

interface ZipFileEntry {
  zipPath: string
  fsPath: string
}

interface ZipSource {
  zipPath: string
  fsPath: string
  isDir?: boolean
}

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

// Minimal self-contained ZIP writer (no bundled tar/zip dependency — this app
// avoids new npm deps given how flaky installs are in this environment; see
// project notes). DEFLATE at zlib's max level (9), falling back to STORE per
// file only if deflate somehow expanded it (e.g. already-compressed jpg/png
// covers), which is standard zip behavior, not a compression compromise.
export async function createZip(items: ZipSource[], outputZipPath: string): Promise<void> {
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

  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0
  const now = new Date()
  const dosTime = toDosTime(now)
  const dosDate = toDosDate(now)

  for (const file of files) {
    const data = await fs.readFile(file.fsPath)
    const crc = crc32(data)
    const deflated = deflateRawSync(data, { level: 9 })
    const useStore = deflated.length >= data.length
    const method = useStore ? 0 : 8
    const payload = useStore ? data : deflated
    const nameBuf = Buffer.from(file.zipPath, 'utf-8')

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
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
    localChunks.push(localHeader, nameBuf, payload)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0x0800, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(dosTime, 12)
    centralHeader.writeUInt16LE(dosDate, 14)
    centralHeader.writeUInt32LE(crc, 16)
    centralHeader.writeUInt32LE(payload.length, 20)
    centralHeader.writeUInt32LE(data.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(offset, 42)
    centralChunks.push(centralHeader, nameBuf)

    offset += localHeader.length + nameBuf.length + payload.length
  }

  const centralStart = offset
  const centralBuf = Buffer.concat(centralChunks)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20)

  await fs.writeFile(outputZipPath, Buffer.concat([...localChunks, centralBuf, eocd]))
}

function findEocd(buf: Buffer): number {
  const sig = 0x06054b50
  const minLen = 22
  const searchStart = Math.max(0, buf.length - minLen - 65535)
  for (let i = buf.length - minLen; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === sig) return i
  }
  return -1
}

export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const buf = await fs.readFile(zipPath)
  const eocdOffset = findEocd(buf)
  if (eocdOffset === -1) throw new Error('Not a valid backup archive (no end-of-central-directory record found).')
  const entryCount = buf.readUInt16LE(eocdOffset + 10)
  const centralStart = buf.readUInt32LE(eocdOffset + 16)

  let ptr = centralStart
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Corrupt backup archive (bad central directory).')
    const method = buf.readUInt16LE(ptr + 10)
    const compressedSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localOffset = buf.readUInt32LE(ptr + 42)
    const name = buf.toString('utf-8', ptr + 46, ptr + 46 + nameLen)

    const normalized = name.replace(/\\/g, '/')
    if (normalized.includes('..') || normalized.startsWith('/')) {
      throw new Error(`Refusing to extract unsafe path in backup archive: ${name}`)
    }

    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const compressed = buf.subarray(dataStart, dataStart + compressedSize)
    const data = method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed)

    const destPath = join(destDir, normalized)
    await fs.mkdir(dirname(destPath), { recursive: true })
    await writeFileAtomic(destPath, data)

    ptr += 46 + nameLen + extraLen + commentLen
  }
}
