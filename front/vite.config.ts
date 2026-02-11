import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ""); // charge .env, .env.local, etc.

  const allowedHosts = (env.VITE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      allowedHosts,
    },
  };
});
