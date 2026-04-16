import type { IncomingMessage, ServerResponse } from "node:http";

process.env.API_EMBEDDED_SERVER = "0";

type TelegramWebhookProcessResult = {
  status: number;
  body: Record<string, unknown>;
};

const appModule = await import("../dist/index.cjs");
const moduleExports = appModule as {
  processTelegramWebhook?: (rawBody: string, incomingSecretHeader: string | null | undefined) => Promise<TelegramWebhookProcessResult>;
  default?: {
    processTelegramWebhook?: (rawBody: string, incomingSecretHeader: string | null | undefined) => Promise<TelegramWebhookProcessResult>;
  };
};

const processTelegramWebhook =
  moduleExports.processTelegramWebhook ?? moduleExports.default?.processTelegramWebhook;

if (typeof processTelegramWebhook !== "function") {
  throw new Error("processTelegramWebhook was not found in dist bundle.");
}

async function readRawBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  const rawBody = await readRawBody(req);
  const incomingSecretRaw = req.headers["x-telegram-bot-api-secret-token"];
  const incomingSecret = Array.isArray(incomingSecretRaw) ? incomingSecretRaw[0] : incomingSecretRaw;
  const result = await processTelegramWebhook(rawBody, incomingSecret);

  res.statusCode = result.status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(result.body));
}
