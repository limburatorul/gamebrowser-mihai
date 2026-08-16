import { spawn } from 'child_process'

// Anything after the exe and working directory is the game's own arguments,
// set per-game in the Edit dialog.
const [exePath, cwd, ...args] = process.argv.slice(2)

let child: ReturnType<typeof spawn>
try {
  child = spawn(exePath, args, { cwd, detached: true, stdio: 'ignore' })
} catch {
  process.exit(1)
}

child.once('exit', () => process.exit(0))
child.once('error', () => process.exit(1))
