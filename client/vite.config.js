import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api to the Express backend so the browser can use
// same-origin requests during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        // During a backend restart (e.g. `node --watch` reloading on a save) the
        // proxy briefly can't reach :4000 and Vite spams ECONNRESET/ECONNREFUSED
        // stack traces. Replace Vite's noisy error logger with a quiet handler
        // that returns a soft 503 — which the client already tolerates — and logs
        // a single short line instead of a stack trace.
        configure: (proxy) => {
          proxy.removeAllListeners('error');
          proxy.on('error', (err, req, res) => {
            const transient = err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET');
            if (!transient) {
              // Unexpected proxy error — surface it so we don't hide real bugs.
              console.error(`[vite] proxy error for ${req?.url}:`, err);
            }
            // `res` is a ServerResponse for HTTP, or a raw socket for upgrades.
            if (res && typeof res.writeHead === 'function') {
              if (!res.headersSent) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Backend unavailable (restarting?)' }));
              }
            } else if (res && typeof res.end === 'function') {
              try {
                res.end();
              } catch {
                /* socket already gone */
              }
            }
          });
        },
      },
    },
  },
});
