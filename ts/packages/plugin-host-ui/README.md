# @hollis-labs/plugin-host-ui

Host-neutral provisioning extracted from Nanite's importmap and `_host` entry mechanism. This package currently exports **only `./vite`**. Rendering, root and settings APIs are separate work; this is neither a plugin loader nor a consumer migration. CW-20261003-0051 follows ADR draft `tesseract://item/01M41F8TKPQTMR6AVM3J7GRY69`.

## Host importmap

```ts
import { defineConfig } from 'vite'
import { designKitEntries, pluginHostImportmap } from '@hollis-labs/plugin-host-ui/vite'

export default defineConfig({
  base: '/admin/',
  plugins: [pluginHostImportmap({ entries: [
    { specifier: 'react', source: 'react', exports: ['createElement', 'useState', 'version'], defaultExport: true },
    { specifier: 'react-dom', source: 'react-dom', exports: ['createPortal', 'flushSync'] },
    { specifier: 'react-dom/client', source: 'react-dom/client', exports: ['createRoot', 'hydrateRoot'] },
    { specifier: 'react/jsx-runtime', source: 'react/jsx-runtime', exports: ['Fragment', 'jsx', 'jsxs'] },
    ...designKitEntries('@example/ui', {
      button: { source: '@hollis-labs/design-components', exports: ['Button'] },
    }),
  ] })],
})
```

Install the host's React, React DOM and design-kit packages in the host; this helper does not install or bundle a private runtime. Explicitly list **every export your plugins are allowed to import**, including any additional React APIs: the short example above is a small contract, not a full React export list. Missing named/default exports fail the production build. Duplicate specifiers are refused when configuring the plugin. Files may be absolute paths or `./` paths relative to the Vite root. Bare module names resolve from the host.

The helper adds runtime entry chunks with strict export signatures and injects an importmap before module scripts. Vite dev serves virtual re-export entries; production maps their emitted filenames. `/` and absolute subpath bases such as `/admin/` are supported. Main application imports and plugin imports resolve the same host modules within one realm. Plugin bundlers must externalize every mapped specifier (including `react/jsx-runtime`) instead of bundling another copy. A browser supporting native importmaps is required; no obsolete contract aliases or automatic `@nanite/ui` rewrite is installed.

Existing Rollup inputs are retained. The helper reserves input names `plugin-host-ui-N`. It leaves routing, API proxying and theme selection to the host. Apply it once per host build. A standalone buildable host at `examples/importmap-host` demonstrates provisioning without an app dependency:

```sh
cd ts
npm ci
npm run build -w @hollis-labs/plugin-host-ui
npx vite build --config packages/plugin-host-ui/examples/importmap-host/vite.config.ts
```

## Stylesheet ownership

The Vite helper provides a browser-only virtual module; Node/Vite dependencies do not enter its output:

```ts
import { createStylesheetLeases } from 'virtual:plugin-host-ui/stylesheets'

const leases = createStylesheetLeases(document)
const generation = { owner: 'notes', generation: 'accepted-generation-id' }
const release = leases.acquire(generation, '/plugins/notes/styles.css')
// During revoke/unload, before loading another generation:
leases.releaseOwner(generation)
release() // releases are idempotent
// On host disposal:
leases.dispose()
```

Each lease is owner/generation scoped; canonical absolute URLs share one link until the last lease releases. One manager belongs to one document/host scope; call its release hooks from the host lifecycle. The manager removes only nodes it created, never host/design-kit theme links. Pass only stylesheet URLs already admitted by the host's trust/CSP policy. HTTP(S) URLs are supported; this mechanism is not sandboxing or origin admission. Failed/unaccepted plugins must acquire no leases. Browser stylesheet loading failures are surfaced by normal link events; a lease is resource ownership, not a load-success receipt.

For TypeScript, declare the virtual module in the host's ambient types (the example includes a declaration). Its `StylesheetLeases` and `StylesheetOwner` types are type-only exports from `./vite`; browser code must import the implementation through the virtual module, not the Node build helper.

## Versions and isolation

`VersionAdmission<T>` carries host-declared version strings and a required `check(requirements, versions)` callback. `admitPluginVersions` delegates that decision and returns `{ accepted: true }` or `{ accepted: false, reason }`. `T` is a host normalization of the reviewed contract, **not a new registry/manifest wire schema**. CW-20261003-0037 owns runtime/design-kit requirement fields and enforcement. Invoke admission before executing/adopting a plugin or leasing its stylesheet. The helper itself does not check version ranges or bundle integrity.

An iframe has a different JavaScript realm and its own runtime singleton set/importmap. It cannot share the literal parent's React object. A typed capability bridge and the frame's import strategy belong to CW-20261002-0145; this helper implements neither isolation nor bridge authority.

## Design-kit tokens and CSS

Use the host's design-kit version and semantic tokens for foreground, surface, border, danger, spacing, type and radius. Import its documented token/theme CSS once in the host; never lease it as plugin CSS. Components may be mapped under any configured namespace using `designKitEntries`. CSS is not an executable importmap export: styles enter through the host stylesheet build or an admitted stylesheet lease. In a Tailwind v4 host, import the installed design package's documented `source.css` entry or declare its sources for scanning; later UI exports will document their own source integration. Plugin CSS must use scoped selectors and host token variables; do not override the global host theme. This helper does not copy a palette or change theme classes.

## Checks

From `ts/`: `npm run typecheck -w @hollis-labs/plugin-host-ui` and `npm test -w @hollis-labs/plugin-host-ui`. Tests exercise actual Vite dev HTTP responses, production emitted specifier/export resolution, subpath bases, singleton deduplication, missing exports, duplicate specifiers, stylesheet generation/disposal and the admission seam. The workspace's existing typecheck/build/test/pack gate remains the landing gate.
