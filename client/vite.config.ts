import { defineConfig } from 'vite';

export default defineConfig({
  // Other local projects sit on 5173–5200; fail loudly instead of drifting to another port.
  server: { port: 5240, strictPort: true, host: true },
  build: { target: 'es2022', sourcemap: true },
});
