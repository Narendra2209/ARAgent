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
        // While the backend is down or restarting, the proxy can't reach :4000
        // and Vite's built-in handler dumps a full ECONNRESET/ECONNREFUSED stack
        // trace per request. Swap it for a quiet handler that answers a soft 503
        // — which the client already tolerates — and logs one short line.
        //
        // The deferral matters: Vite runs `configure(proxy, opts)` and only
        // *then* does `proxy.on('error', ...)`, so removing listeners
        // synchronously here removes nothing and Vite's logger is attached right
        // after, winning. A microtask runs once Vite's synchronous setup has
        // finished, so ours ends up the only error listener.
        configure: (proxy) => {
          queueMicrotask(() => {
            proxy.removeAllListeners('error');
            proxy.on('error', (err, req, res) => {
              const transient = err && (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET');
              if (transient) {
                console.log(`[api] backend unavailable (${err.code}) for ${req?.url ?? '?'}`);
              } else {
                // Unexpected proxy error — surface it so we don't hide real bugs.
                console.error(`[vite] proxy error for ${req?.url}:`, err);
              }
              // `res` is a ServerResponse for HTTP, or a raw socket for upgrades.
              if (res && typeof res.writeHead === 'function') {
                if (!res.headersSent && !res.writableEnded) {
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
          });
        },
      },
    },
  },
});
