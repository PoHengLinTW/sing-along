import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS on the LAN so iPhone Safari allows getUserMedia (secure context required).
export default defineConfig({
  plugins: [basicSsl()],
  build: { rollupOptions: { input: { main: 'index.html', wave: 'wave.html' } } },
  server: { host: true, https: {} as never, port: 5173 },
});
