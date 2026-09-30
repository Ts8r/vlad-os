import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// HUD V.A.U.L.T. — root = ui/, sert index.html + app.jsx.
// Le .env est celui de la racine du projet (seules les variables VITE_* arrivent au navigateur).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const bridge = process.env.VLAD_PORT || 8788;   // port du pont (voir .env.example)
  // hôte du tunnel (ex. Cloudflare) si VLAD est ouvert depuis l'extérieur
  const publicHost = (env.VITE_VLAD_PUBLIC_URL || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return {
    root: "ui",
    envDir: process.cwd(),
    plugins: [react()],
    server: {
      port: 5173, open: false, host: true,               // accessible depuis l'iPhone (même wifi)
      allowedHosts: publicHost ? [publicHost] : [],
      proxy: { "/api": { target: "http://localhost:" + bridge, changeOrigin: true } },  // le pont répond sur /api
    },
  };
});
