import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS on the LAN so iPhone Safari allows getUserMedia (secure context required).
export default defineConfig({
  plugins: [basicSsl()],
  server: { host: true, https: {} as never, port: 5173 },
});
