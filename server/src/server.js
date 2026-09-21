import 'dotenv/config';
import { createRestaurantServer } from './app.js';
import { loadEnvFile } from './env.js';

loadEnvFile();

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 8787);
const { server } = await createRestaurantServer();

server.listen(port, host, () => {
  console.log(`Restaurant Agent server listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
