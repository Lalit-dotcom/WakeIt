import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  resolve: {
  dedupe: ['react', 'react-dom', 'lucide-react'],
  alias: {
    wakeit: path.resolve(import.meta.dirname, '../../src/index.ts'),
  },
},
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'mock-health-server',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/api/health')) {
            const urlParams = new URLSearchParams(req.url.split('?')[1] || '');
            const delay = parseInt(urlParams.get('delay') || '0', 10);
            const fail = urlParams.get('fail') === 'true';

            setTimeout(() => {
              if (fail) {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ status: 'error', message: 'Backend cold-start failed' }));
              } else {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
              }
            }, delay);
            return;
          }
          next();
        });
      },
    },
  ],
});
