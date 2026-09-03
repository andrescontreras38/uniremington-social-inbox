import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    // Puerto propio, no el 5173 por omision de Vite: ese origen lo comparten
    // todos los proyectos Vite de la maquina, y con el se comparten cookies,
    // localStorage y los datos que el navegador recuerda de los formularios.
    port: 5273,
    strictPort: true,
    proxy: {
      // Durante el desarrollo el frontend y la API comparten origen a traves
      // del proxy: la cookie de sesion viaja sin configuracion adicional.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
