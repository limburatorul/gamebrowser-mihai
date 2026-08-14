// sql.js ships no TypeScript types of its own - minimal shape of the subset used here.
declare module 'sql.js' {
  export interface SqlJsStatement {
    bind(params: unknown[]): void
    step(): boolean
    get(): unknown[]
    free(): void
  }

  export interface Database {
    prepare(sql: string): SqlJsStatement
    close(): void
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database
  }

  export interface SqlJsConfig {
    wasmBinary?: Uint8Array | Buffer
    locateFile?: (file: string) => string
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
}
