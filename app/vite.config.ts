import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // .riv is not a Vite asset type by default; without this the mascot import
  // would be handed to the JS pipeline instead of emitted as a file.
  assetsInclude: ['**/*.riv'],
  server: {
    port: 3000,
  },
})
