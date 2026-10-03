import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

function offlineShell() {
  let assets = []
  let version
  let output
  return {
    name: 'offline-shell',
    apply: 'build',
    configResolved(config) {
      output = resolve(config.root, config.build.outDir)
    },
    async generateBundle(_, bundle) {
      assets = [
        ...Object.keys(bundle),
        'index.html',
        'manifest.webmanifest',
        'favicon-32.png',
        'pwa-192.png',
        'pwa-512.png',
        'pwa-maskable-512.png',
        'apple-touch-icon.png'
      ]
      assets = [...new Set(assets)].filter((p) => !p.endsWith('.map'))
      const template = await readFile('public/sw.js', 'utf8')
      const hash = createHash('sha256').update(template)
      for (const name of Object.keys(bundle).sort())
        hash.update(name).update(bundle[name].code || bundle[name].source)
      // Include unhashed public resources as well as content-hashed build assets.
      for (const name of assets.filter((n) => !bundle[n]))
        hash.update(
          await readFile(name === 'index.html' ? name : `public/${name}`)
        )
      version = hash.digest('hex').slice(0, 16)
    },
    async closeBundle() {
      if (!version) return
      const template = await readFile('public/sw.js', 'utf8')
      await writeFile(
        resolve(output, 'sw.js'),
        template
          .replace('__BUILD_VERSION__', version)
          .replace('__PRECACHE_ASSETS__', JSON.stringify(assets))
      )
    }
  }
}
export default defineConfig({
  base: './',
  plugins: [vue(), tailwindcss(), offlineShell()]
})
