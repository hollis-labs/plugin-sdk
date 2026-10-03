import { afterEach, describe, expect, it } from 'vitest'
import { build, createServer } from 'vite'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { admitPluginVersions, designKitEntries, pluginHostImportmap } from '../dist/vite.js'
import type { Rollup } from 'vite'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function host() {
  const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'host-importmap-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'index.html'), '<html><head></head><body><script type="module" src="./src/main.js"></script></body></html>')
  await writeFile(join(root, 'src/shared.js'), 'export const singleton = {}; export const Button = () => "button"; export default singleton;')
  await writeFile(join(root, 'src/main.js'), 'import { singleton } from "./shared.js"; globalThis.hostSingleton = singleton;')
  const entries = [{ specifier: 'react', source: './src/shared.js', exports: ['singleton'], defaultExport: true },
    ...designKitEntries('@example/ui', { button: { source: './src/shared.js', exports: ['Button'] } })]
  return { root, entries }
}
function importmap(html: string): { imports: Record<string, string> } {
  return JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/u)![1])
}

describe.each(['/', '/admin/'])('base %s', base => {
  it('serves dev importmap entries with the declared named/default exports', async () => {
    const { root, entries } = await host()
    const server = await createServer({ root, base, configFile: false, optimizeDeps: { noDiscovery: true }, plugins: [pluginHostImportmap({ entries })], server: { host: '127.0.0.1', port: 0 } })
    cleanups.push(() => server.close())
    await server.listen()
    const origin = new URL(server.resolvedUrls!.local[0]).origin
    const html = await (await fetch(`${origin}${base}`)).text()
    const map = importmap(html)
    expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'))
    for (const entry of entries) {
      const url = map.imports[entry.specifier]
      expect(url.startsWith(base)).toBe(true)
      const response = await fetch(`${origin}${url}`)
      expect(response.status).toBe(200)
      const module = await response.text()
      for (const name of entry.exports) expect(module).toContain(name)
      if (entry.defaultExport) expect(module).toContain('default')
    }
  })
  it('builds production entries, preserves exports and uses one shared singleton module', async () => {
    const { root, entries } = await host()
    const result = await build({ root, base, configFile: false, logLevel: 'silent', plugins: [pluginHostImportmap({ entries })], build: { write: false, minify: false, modulePreload: { polyfill: false } } }) as Rollup.RollupOutput
    const asset = result.output.find((item): item is Rollup.OutputAsset => item.type === 'asset' && item.fileName === 'index.html')!
    const html = String(asset.source)
    const map = importmap(html)
    expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'))
    for (const entry of entries) {
      const path = map.imports[entry.specifier]
      expect(path.startsWith(base)).toBe(true)
      const chunk = result.output.find(item => `${base}${item.fileName}` === path) as Rollup.OutputChunk
      expect(chunk.exports).toEqual(expect.arrayContaining([...entry.exports, ...(entry.defaultExport ? ['default'] : [])]))
    }
    // Execute the emitted entries: the host and dynamically loaded plugin runtime
    // must observe the same object, even after Rollup splits chunks.
    for (const item of result.output) {
      if (item.type !== 'chunk') continue
      const destination = join(root, 'dist', item.fileName)
      await mkdir(join(destination, '..'), { recursive: true })
      await writeFile(destination, item.code)
    }
    await writeFile(join(root, 'package.json'), '{"type":"module"}')
    const main = result.output.find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.isEntry && item.name === 'main')!
    await import(pathToFileURL(join(root, 'dist', main.fileName)).href)
    const runtime = await import(pathToFileURL(join(root, 'dist', map.imports.react.slice(base.length))).href)
    const state = globalThis as { hostSingleton?: unknown }
    expect(runtime.singleton).toBe(state.hostSingleton)
    expect(runtime.default).toBe(state.hostSingleton)
    delete state.hostSingleton
  })
})

it('refuses duplicate specifiers before starting the build', () => {
  const entry = { specifier: 'react', source: 'react', exports: ['version'] }
  expect(() => pluginHostImportmap({ entries: [entry, entry] })).toThrow('Duplicate host specifier: react')
})
it('fails the build for a requested export missing from the host module', async () => {
  const { root, entries } = await host()
  entries[0].exports = ['missing']
  await expect(build({ root, configFile: false, logLevel: 'silent', plugins: [pluginHostImportmap({ entries })], build: { write: false } })).rejects.toThrow(/missing/u)
})
it('provides a browser-only stylesheet virtual module', async () => {
  const { root, entries } = await host()
  await writeFile(join(root, 'src/main.js'), 'import { createStylesheetLeases } from "virtual:plugin-host-ui/stylesheets"; globalThis.leases = createStylesheetLeases(document);')
  const output = await build({ root, configFile: false, logLevel: 'silent', plugins: [pluginHostImportmap({ entries })], build: { write: false, minify: false } }) as Rollup.RollupOutput
  const code = output.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n')
  expect(code).toContain('createStylesheetLeases')
  expect(code).not.toContain('node:fs')
})
it('delegates admission to host policy without inventing wire fields', () => {
  const admission = { versions: { react: '19.3.0' }, check: (required: string, versions: Readonly<Record<string, string>>) => required === versions.react ? { accepted: true as const } : { accepted: false as const, reason: 'runtime mismatch' } }
  expect(admitPluginVersions(admission, '19.3.0')).toEqual({ accepted: true })
  expect(admitPluginVersions(admission, '18.0.0')).toEqual({ accepted: false, reason: 'runtime mismatch' })
})

it('provisions the actual host React CJS package in dev and production', async () => {
  const { root } = await host()
  await symlink(fileURLToPath(new URL('../../../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir')
  await writeFile(join(root, 'src/main.js'), 'import { useState } from "react"; globalThis.hostReactHook = useState;')
  const entries = [{ specifier: 'react', source: 'react', exports: ['useState', 'createElement', 'version'], defaultExport: true }]
  const server = await createServer({ root, configFile: false, plugins: [pluginHostImportmap({ entries })], optimizeDeps: { include: ['react'], noDiscovery: true }, server: { host: '127.0.0.1', port: 0 } })
  cleanups.push(() => server.close())
  await server.listen()
  const origin = new URL(server.resolvedUrls!.local[0]).origin
  const html = await (await fetch(origin)).text()
  const response = await fetch(`${origin}${importmap(html).imports.react}`)
  expect(response.status).toBe(200)
  const entryCode = await response.text()
  expect(entryCode).toContain('useState')
  expect(entryCode).toContain('default')
  const result = await build({ root, configFile: false, logLevel: 'silent', plugins: [pluginHostImportmap({ entries })], build: { write: false, minify: false, modulePreload: { polyfill: false } } }) as Rollup.RollupOutput
  for (const item of result.output) {
    if (item.type !== 'chunk') continue
    const path = join(root, 'dist', item.fileName)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, item.code)
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}')
  const main = result.output.find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.name === 'main')!
  const entry = result.output.find((item): item is Rollup.OutputChunk => item.type === 'chunk' && item.name === 'plugin-host-ui-0')!
  await import(pathToFileURL(join(root, 'dist', main.fileName)).href)
  const react = await import(pathToFileURL(join(root, 'dist', entry.fileName)).href)
  const state = globalThis as { hostReactHook?: unknown }
  expect(react.useState).toBe(state.hostReactHook)
  expect(react.default.useState).toBe(state.hostReactHook)
  delete state.hostReactHook
})
