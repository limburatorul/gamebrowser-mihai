import { promises as fs } from 'fs'

// Writes via a temp file + rename instead of an in-place fs.writeFile, so a
// concurrent reader (e.g. a live <img> re-fetching a cover mid-restore) can
// never observe a half-written/truncated file - it sees either the old
// complete file or the new one, never a torn read in between.
export async function writeFileAtomic(destPath: string, data: Buffer): Promise<void> {
  const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await fs.writeFile(tmpPath, data)
  await fs.rename(tmpPath, destPath)
}

export async function copyFileAtomic(srcPath: string, destPath: string): Promise<void> {
  const tmpPath = `${destPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await fs.copyFile(srcPath, tmpPath)
  await fs.rename(tmpPath, destPath)
}
