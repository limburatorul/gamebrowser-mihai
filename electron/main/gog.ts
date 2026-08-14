import { promises as fs } from 'fs'
import { join, basename } from 'path'
import { app } from 'electron'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'

const GOG_DB_PATH = 'C:\\ProgramData\\GOG.com\\Galaxy\\storage\\galaxy-2.0.db'

let sqlJsPromise: Promise<SqlJsStatic> | null = null

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const wasmPath = join(app.getAppPath(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
      const wasmBinary = await fs.readFile(wasmPath)
      return initSqlJs({ wasmBinary })
    })()
  }
  return sqlJsPromise
}

function queryAll(db: Database, sql: string, params: unknown[] = []): unknown[][] {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    const rows: unknown[][] = []
    while (stmt.step()) rows.push(stmt.get())
    return rows
  } finally {
    stmt.free()
  }
}

export interface GogGame {
  productId: string
  installDir: string
  name: string
}

// GOG Galaxy has no simple manifest files like Steam's VDF or Epic's JSON -
// installed-game info lives in a SQLite database instead. The table/column
// names below are based on community reverse-engineering of GOG Galaxy 2.0,
// NOT verified against a real installation (none available to test against
// on the dev machine, unlike Steam/Epic which were confirmed end-to-end). If
// this returns 0 games on a real GOG install, these are the first thing to
// check against the actual `galaxy-2.0.db` schema (e.g. via a SQLite browser
// tool pointed at that file). The title lookup failing is non-fatal either
// way - falls back to the install folder's name.
export async function findGogGames(): Promise<GogGame[]> {
  try {
    await fs.access(GOG_DB_PATH)
  } catch {
    return []
  }
  const SQL = await getSqlJs()
  const dbBuffer = await fs.readFile(GOG_DB_PATH)
  const db = new SQL.Database(new Uint8Array(dbBuffer))
  try {
    const installedRows = queryAll(db, 'SELECT productId, installationPath FROM InstalledBaseProducts')
    const games: GogGame[] = []
    for (const row of installedRows) {
      const productId = String(row[0])
      const installDir = String(row[1])
      let name = basename(installDir)
      try {
        const titleRows = queryAll(
          db,
          `SELECT gp.value FROM GamePieces gp
           JOIN GamePieceTypes gpt ON gpt.id = gp.gamePieceTypeId
           WHERE gpt.type = 'title' AND gp.releaseKey = ?`,
          [`gog_${productId}`]
        )
        const raw = titleRows[0]?.[0]
        if (typeof raw === 'string') {
          const parsed = JSON.parse(raw) as { title?: string | Record<string, string> }
          if (typeof parsed.title === 'string') name = parsed.title
          else if (parsed.title && typeof parsed.title === 'object') {
            const first = Object.values(parsed.title)[0]
            if (typeof first === 'string') name = first
          }
        }
      } catch {
        // title lookup schema mismatch - keep the folder-name fallback
      }
      games.push({ productId, installDir, name })
    }
    return games
  } finally {
    db.close()
  }
}
