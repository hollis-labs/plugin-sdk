import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

export type { StylesheetOwner, StylesheetLeases } from './stylesheets.js'

export interface HostEntry {
  /** Exact bare specifier expected by plugin bundles. */
  specifier: string
  /** Host-installed module or absolute/host-root-relative source file. */
  source: string
  /** Explicit named re-exports avoid CJS/ESM namespace ambiguity. */
  exports: readonly string[]
  defaultExport?: boolean
}

/** Caller normalizes the reviewed wire requirements; this is not a wire schema. */
export interface VersionAdmission<Requirements> {
  versions: Readonly<Record<string, string>>
  check(requirements: Requirements, versions: Readonly<Record<string, string>>):
    { accepted: true } | { accepted: false; reason: string }
}

export function admitPluginVersions<T>(admission: VersionAdmission<T>, requirements: T) {
  return admission.check(requirements, admission.versions)
}

/** Build entries for any host's component namespace; no Nanite prefix. */
export function designKitEntries(prefix: string, components: Readonly<Record<string, Omit<HostEntry, 'specifier'>>>): HostEntry[] {
  if (!prefix || prefix.endsWith('/')) throw new Error('Specifier prefix must be nonempty without a trailing slash')
  return Object.entries(components).map(([name, entry]) => ({ ...entry, specifier: `${prefix}/${name}` }))
}

export interface PluginHostImportmapOptions { entries: readonly HostEntry[] }
const namespace = 'plugin-host-ui:entry:'
const styles = 'virtual:plugin-host-ui/stylesheets'

export function pluginHostImportmap(options: PluginHostImportmapOptions): Plugin {
  const entries = options.entries.map(entry => ({ ...entry, exports: [...entry.exports] }))
  const specifiers = new Set<string>()
  for (const entry of entries) {
    if (!entry.specifier || /[\s<>]/u.test(entry.specifier) || entry.specifier.startsWith('.') || entry.specifier.startsWith('/') || entry.specifier.includes(':')) {
      throw new Error(`Invalid bare specifier: ${entry.specifier}`)
    }
    if (specifiers.has(entry.specifier)) throw new Error(`Duplicate host specifier: ${entry.specifier}`)
    specifiers.add(entry.specifier)
    if (!entry.source || (!entry.exports.length && !entry.defaultExport)) throw new Error(`Missing source or exports for ${entry.specifier}`)
    if (new Set(entry.exports).size !== entry.exports.length || entry.exports.some(name => !/^[A-Za-z_$][\w$]*$/u.test(name) || name === 'default')) {
      throw new Error(`Invalid or duplicate named exports for ${entry.specifier}`)
    }
  }
  let config: ResolvedConfig
  const inputName = (index: number) => `plugin-host-ui-${index}`
  const virtualId = (index: number) => `${namespace}${index}`
  const sourceFor = (source: string) => source.startsWith('.') ? resolve(config.root, source) : source
  return {
    name: 'plugin-host-ui-importmap',
    enforce: 'post',
    config(userConfig) {
      const root = resolve(userConfig.root ?? process.cwd())
      const original = userConfig.build?.rollupOptions?.input ?? resolve(root, 'index.html')
      const inputs = typeof original === 'string' ? { main: original }
        : Array.isArray(original) ? Object.fromEntries(original.map((path, i) => [`host-${i}`, path])) : original
      for (let i = 0; i < entries.length; i++) {
        if (inputName(i) in inputs) throw new Error(`Host entry input collision: ${inputName(i)}`)
      }
      return { build: { rollupOptions: {
        input: { ...inputs, ...Object.fromEntries(entries.map((_, i) => [inputName(i), virtualId(i)])) },
        preserveEntrySignatures: 'strict',
      } } }
    },
    configResolved(resolved) { config = resolved },
    resolveId(id) {
      if (id === styles) return `\0${styles}`
      if (id.startsWith(namespace)) return `\0${id}`
    },
    load(id) {
      if (id === `\0${styles}`) {
        return readFileSync(new URL('./stylesheets.js', import.meta.url), 'utf8')
      }
      if (!id.startsWith(`\0${namespace}`)) return
      const entry = entries[Number(id.slice(namespace.length + 1))]
      if (!entry) throw new Error(`Unknown host entry: ${id}`)
      const source = JSON.stringify(sourceFor(entry.source))
      return [
        entry.exports.length ? `export { ${entry.exports.join(', ')} } from ${source};` : '',
        entry.defaultExport ? `export { default } from ${source};` : '',
      ].join('\n')
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const imports: Record<string, string> = Object.create(null)
        entries.forEach((entry, index) => {
          if (!context.bundle) {
            imports[entry.specifier] = `${config.base}@id/__x00__${virtualId(index)}`
            return
          }
          const chunk = Object.values(context.bundle).find(chunk => chunk.type === 'chunk' && chunk.isEntry && chunk.name === inputName(index))
          if (!chunk || chunk.type !== 'chunk') throw new Error(`Missing emitted host entry for ${entry.specifier}`)
          const expected = [...entry.exports, ...(entry.defaultExport ? ['default'] : [])]
          if (expected.some(name => !chunk.exports.includes(name))) throw new Error(`Missing emitted export for ${entry.specifier}`)
          imports[entry.specifier] = `${config.base}${chunk.fileName}`
        })
        // Escape HTML delimiters in a script raw-text element.
        const children = JSON.stringify({ imports }).replaceAll('<', '\\u003c')
        return [{ tag: 'script', attrs: { type: 'importmap' }, children, injectTo: 'head-prepend' }]
      },
    },
  }
}
