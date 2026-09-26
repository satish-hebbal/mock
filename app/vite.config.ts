import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // .riv is not a Vite asset type by default; without this the mascot import
  // would be handed to the JS pipeline instead of emitted as a file.
  assetsInclude: ['**/*.riv'],
  // the home page shows it under the name; package.json is the one place it is set
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 3000,
  },
})
