import { loadConfig } from "./config.ts";
import { createApp } from "./server.ts";

const config = loadConfig();
const { app, store } = createApp(config);

await store.init();

const port = config.server.port;

console.log(`🚀 Socials running at http://localhost:${port}`);
console.log(`📡 API:       http://localhost:${port}/api/health`);
console.log(`🔑 Login:     http://localhost:${port}/auth/login`);
console.log(`📊 Dashboard: http://localhost:${port}/`);

Deno.serve({ port, hostname: config.server.host }, app.fetch);
