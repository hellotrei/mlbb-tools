import { handle } from "@hono/node-server/vercel";
import type { IncomingMessage, ServerResponse } from "node:http";
import app from "../dist/index.js";

const honoHandler = handle(app);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async (req: IncomingMessage & { rawBody?: Buffer }, res: ServerResponse) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.rawBody === undefined) {
    req.rawBody = await readBody(req).catch(() => Buffer.alloc(0));
  }
  return honoHandler(req, res);
};
