import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Do not load application .env files or expose normal VITE_* variables.
  envDir: fileURLToPath(new URL("./.speech-lab-no-env", import.meta.url)),
  envPrefix: "SPEECH_LAB_PUBLIC_",
  publicDir: false,
  css: { postcss: { plugins: [] } },
  plugins: [react(), {
    name: "speech-lab-isolation",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5174 ws://localhost:5174; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        let pathname: string;
        try { pathname = decodeURIComponent((req.url || "/").split("?")[0]); }
        catch { res.statusCode = 400; res.end("Invalid path."); return; }
        const allowed = pathname === "/speech-lab.html" || pathname === "/favicon.ico" || pathname.startsWith("/src/experiments/speech-lab/") || pathname.startsWith("/api/speech-lab/") || pathname.startsWith("/node_modules/.vite/") || pathname === "/node_modules/vite/dist/client/env.mjs" || pathname === "/@vite/client" || pathname === "/@react-refresh" || pathname.startsWith("/@fs/") && pathname.includes("/node_modules/vite/");
        if (!allowed || pathname.includes("..") || pathname.includes("\\")) { res.statusCode = 404; res.end("Open /speech-lab.html. Application routes are unavailable on this server."); return; }
        next();
      });
    },
  }],
  server: {
    host: "127.0.0.1", port: 5174, strictPort: true,
    proxy: { "/api/speech-lab": { target: "http://127.0.0.1:5002", changeOrigin: true } },
  },
  build: { outDir: "dist-speech-lab", rollupOptions: { input: fileURLToPath(new URL("./speech-lab.html", import.meta.url)) } },
});
