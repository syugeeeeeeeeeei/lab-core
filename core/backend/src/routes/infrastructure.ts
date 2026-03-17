import { Hono } from "hono";
import { env } from "../lib/env.js";
import { syncInfrastructure } from "../services/infrastructure-sync.js";

export const infrastructureRouter = new Hono();

infrastructureRouter.post("/sync", (c) => {
  const reason = c.req.query("reason") ?? "manual";
  const result = syncInfrastructure(reason);

  return c.json({
    message: "DNS/Proxy 設定を同期しました。",
    executionMode: env.executionMode,
    ...result
  });
});
