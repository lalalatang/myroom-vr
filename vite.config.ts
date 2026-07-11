import { defineConfig, type Plugin } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

// public/audio/ 内の音源ファイルを列挙した playlist.json を自動生成する。
// mp3 を置くだけでラジオの中身を差し替えられる(GOAL P0-4)。
function audioPlaylist(): Plugin {
  const list = () => {
    try {
      return readdirSync(resolve(import.meta.dirname, 'public/audio'))
        .filter((f) => /\.(mp3|ogg|m4a|wav)$/i.test(f))
        .sort()
    } catch {
      return []
    }
  }
  return {
    name: 'audio-playlist',
    configureServer(server) {
      server.middlewares.use('/audio/playlist.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(list()))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'audio/playlist.json',
        source: JSON.stringify(list()),
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [basicSsl(), audioPlaylist()],
  server: { host: true },
})
