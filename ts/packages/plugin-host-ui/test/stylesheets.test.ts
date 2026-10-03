import { expect, it } from 'vitest'
import { createStylesheetLeases } from '../src/stylesheets.js'

function documentFixture() {
  const links: { rel: string; href: string; remove(): void }[] = []
  const doc = {
    baseURI: 'https://host.example/admin/',
    head: { appendChild(link: typeof links[number]) { links.push(link) } },
    createElement() {
      const link = { rel: '', href: '', remove() { const i = links.indexOf(link); if (i !== -1) links.splice(i, 1) } }
      return link
    },
  }
  return { links, doc: doc as unknown as Document }
}
it('shares URLs across owners and protects the new generation from stale disposal', () => {
  const { doc, links } = documentFixture()
  const leases = createStylesheetLeases(doc)
  const old = { owner: 'a', generation: '1' }, next = { owner: 'a', generation: '2' }, other = { owner: 'b', generation: '1' }
  const release = leases.acquire(old, './plugin.css')
  leases.acquire(next, 'https://host.example/admin/plugin.css')
  leases.acquire(other, './plugin.css')
  expect(links).toHaveLength(1)
  leases.releaseOwner(old)
  release()
  leases.releaseOwner(other)
  expect(links).toHaveLength(1)
  leases.releaseOwner(next)
  expect(links).toHaveLength(0)
})
it('does not remove existing host CSS and disposes all leases idempotently', () => {
  const { doc, links } = documentFixture()
  const hostLink = doc.createElement('link')
  doc.head.appendChild(hostLink)
  const leases = createStylesheetLeases(doc)
  leases.acquire({ owner: 'plugin', generation: '1' }, './plugin.css')
  leases.dispose()
  leases.dispose()
  expect(links).toEqual([hostLink])
  expect(() => leases.acquire({ owner: 'plugin', generation: '2' }, './other.css')).toThrow('disposed')
})
it('refuses executable URL schemes and absent ownership before injection', () => {
  const { doc, links } = documentFixture()
  const leases = createStylesheetLeases(doc)
  expect(() => leases.acquire({ owner: 'plugin', generation: '1' }, 'javascript:alert(1)')).toThrow('scheme')
  expect(() => leases.acquire({ owner: '', generation: '1' }, '/plugin.css')).toThrow('required')
  expect(links).toHaveLength(0)
})
