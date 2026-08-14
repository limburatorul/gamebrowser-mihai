import { spawn } from 'child_process'

const [exePath, cwd] = process.argv.slice(2)

let child: ReturnType<typeof spawn>
try {
  child = spawn(exePath, [], { cwd, detached: true, stdio: 'ignore' })
} catch {
  process.exit(1)
}

child.once('exit', () => process.exit(0))
child.once('error', () => process.exit(1))
