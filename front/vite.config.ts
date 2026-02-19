import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // charge .env, .env.local, etc.

  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const usePolling = (env.VITE_USE_POLLING ?? "").toLowerCase() === "true";
  const pollingInterval = Number.parseInt(env.VITE_POLL_INTERVAL ?? "150", 10);

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      allowedHosts,
      watch: usePolling
        ? {
            usePolling: true,
            interval: Number.isFinite(pollingInterval) ? pollingInterval : 150,
          }
        : undefined,
    },
  };
});
