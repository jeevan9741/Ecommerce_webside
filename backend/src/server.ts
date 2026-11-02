import { env, productionConfigProblems } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { createApp } from "./app.js";
import { checkEmailOnStartup } from "./services/email.service.js";
import { checkPaymentModeOnStartup } from "./services/payment-safety.js";
import { checkBlobStoreOnStartup } from "./services/blob-safety.js";

// Before listening: exits here on Razorpay TEST keys in production, LIVE keys against a non-production
// database, or a production Blob store in a non-production environment.
checkPaymentModeOnStartup();
checkBlobStoreOnStartup();

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  console.log(`CORS origins: ${env.corsOrigins.join(", ")}`);
  for (const problem of productionConfigProblems()) console.warn(`[CONFIG] ${problem}`);
  void checkEmailOnStartup();
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down…`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
