import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// App de navegación — interfaz (Vite + React).
//
// El dev server escucha SOLO en localhost: esta app no es un servicio de red, y quien la
// exponga expone el control de todas las identidades del operador. El proxy apunta al
// servidor local de la app (puerto 8420), no al nodo NARSIL.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5273,
    proxy: {
      '/api':           { target: 'http://127.0.0.1:8420', changeOrigin: true },
      '/profile-start': { target: 'http://127.0.0.1:8420', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
