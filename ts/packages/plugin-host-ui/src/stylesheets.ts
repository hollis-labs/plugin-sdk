/** Browser-only runtime served by the Vite helper's virtual module. */
export interface StylesheetOwner { owner: string; generation: string }
export interface StylesheetLeases {
  acquire(owner: StylesheetOwner, url: string): () => void
  releaseOwner(owner: StylesheetOwner): void
  dispose(): void
}

/** Only nodes created by this instance are removed; host/theme CSS is untouched. */
export function createStylesheetLeases(doc: Document): StylesheetLeases {
  const urls = new Map<string, { link: HTMLLinkElement; count: number }>()
  const owners = new Map<string, Set<() => void>>()
  let disposed = false
  const key = (owner: StylesheetOwner) => JSON.stringify([owner.owner, owner.generation])
  const releaseOwner = (owner: StylesheetOwner) => {
    for (const release of [...(owners.get(key(owner)) ?? [])]) release()
  }
  return {
    acquire(owner, url) {
      if (disposed) throw new Error('Stylesheet leases are disposed')
      if (!owner.owner || !owner.generation) throw new Error('Stylesheet owner and generation are required')
      const href = new URL(url, doc.baseURI).href
      if (!['https:', 'http:'].includes(new URL(href).protocol)) throw new Error('Unsupported stylesheet URL scheme')
      let lease = urls.get(href)
      if (!lease) {
        const link = doc.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        doc.head.appendChild(link)
        lease = { link, count: 0 }
        urls.set(href, lease)
      }
      lease.count++
      const ownerKey = key(owner)
      const releases = owners.get(ownerKey) ?? new Set<() => void>()
      owners.set(ownerKey, releases)
      let active = true
      const release = () => {
        if (!active) return
        active = false
        releases.delete(release)
        if (!releases.size) owners.delete(ownerKey)
        if (--lease.count === 0) {
          lease.link.remove()
          urls.delete(href)
        }
      }
      releases.add(release)
      return release
    },
    releaseOwner,
    dispose() {
      for (const releases of [...owners.values()]) for (const release of [...releases]) release()
      disposed = true
    },
  }
}
