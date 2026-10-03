import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { pluginHostImportmap, designKitEntries } from '../../dist/vite.js'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/example/',
  plugins: [pluginHostImportmap({ entries: [
    { specifier: '@example/runtime', source: './runtime.js', exports: ['state'] },
    ...designKitEntries('@example/ui', { label: { source: './runtime.js', exports: ['label'] } }),
  ] })],
})
