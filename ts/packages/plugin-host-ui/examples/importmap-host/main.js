import { state } from './runtime.js'
import { createStylesheetLeases } from 'virtual:plugin-host-ui/stylesheets'

const leases = createStylesheetLeases(document)
const pluginUrl = `${import.meta.env.BASE_URL}plugin.js`
import(/* @vite-ignore */ pluginUrl).then(plugin => {
  leases.acquire({ owner: 'example', generation: '1' }, `${import.meta.env.BASE_URL}plugin.css`)
  document.getElementById('result').textContent = plugin.render(state)
}).catch(error => { document.getElementById('result').textContent = error.message })
window.addEventListener('pagehide', () => leases.dispose(), { once: true })
