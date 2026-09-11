/**
 * Build-time assertions for the two things the harness is strict about:
 * the browser bundle's factory banner (the loader rejects anything else), and
 * the host bundle carrying no bare runtime import that the profile would have
 * to resolve.
 *
 * Run after `pnpm run build`.
 */
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const failures = []

async function readIfPresent(relative) {
  const path = join(root, relative)
  try {
    await access(path)
  } catch {
    failures.push(`missing build artifact: ${relative}`)
    return null
  }
  return readFile(path, 'utf8')
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const clientId = packageJson.name

const client = await readIfPresent('client/client.js')
if (client !== null) {
  const head = client.slice(0, 240)
  if (!client.startsWith('window.__ModuleLoader__.load({')) {
    failures.push('client/client.js does not start with the module-loader factory call')
  }
  if (!head.includes(`id: "${clientId}"`)) {
    failures.push(`client/client.js banner does not declare id "${clientId}"`)
  }
  const tail = client.slice(-200)
  if (!tail.includes('return module.exports;') || !tail.trimEnd().endsWith('});')) {
    failures.push('client/client.js does not close the module-loader factory')
  }
  const forbidden = [...client.matchAll(/require\((["'])([^"']+)\1\)/g)]
    .map((match) => match[2])
    .filter((specifier) => !['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].includes(specifier))
  if (forbidden.length > 0) {
    failures.push(`client bundle requires non-baseline modules: ${[...new Set(forbidden)].join(', ')}`)
  }
}

const host = await readIfPresent('lib/index.js')
if (host !== null) {
  const specifiers = [...host.matchAll(/^\s*(?:import|export)[^'"]*from\s*["']([^"']+)["']/gm)].map((match) => match[1])
  const bare = specifiers.filter((specifier) => !specifier.startsWith('node:') && !specifier.startsWith('.'))
  if (bare.length > 0) {
    failures.push(`host bundle imports bare packages: ${[...new Set(bare)].join(', ')}`)
  }
}

if (packageJson.dsh?.client?.platform !== 'web') {
  failures.push('package.json dsh.client.platform must be "web"')
}
if (packageJson.exports?.['./client'] === undefined) {
  failures.push('package.json must export "./client"')
}
if (packageJson.dsh?.bundle?.patch === undefined) {
  failures.push('package.json must declare dsh.bundle.patch')
}

const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
if (/^\s*config:/m.test(patch)) {
  failures.push('cordis.patch.yml carries a config: block, which blocks hot-mounting; defaults belong in src/config.ts')
}

if (failures.length > 0) {
  console.error('preflight failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('preflight ok: client banner, host imports, manifest, and patch row all valid')
