import { Hono } from "hono";
import { z } from "zod";
import { listApplicationServices, readApplicationLogs } from "../services/application-logs.js";

const logsQuerySchema = z.object({
  service: z.string().min(1).optional(),
  tail: z.coerce.number().int().min(20).max(1000).optional().default(200)
});

export const logsRouter = new Hono();

logsRouter.get("/:applicationId/services", async (c) => {
  const applicationId = c.req.param("applicationId");

  try {
    const services = await listApplicationServices(applicationId);
    return c.json({ applicationId, services });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ログ対象サービスの取得に失敗しました。";
    if (message.includes("配備情報")) {
      return c.json({ message }, 404);
    }
    return c.json({ message: "ログ対象サービスの取得に失敗しました。", detail: message }, 500);
  }
});

logsRouter.get("/:applicationId", async (c) => {
  const applicationId = c.req.param("applicationId");
  const query = {
    service: c.req.query("service"),
    tail: c.req.query("tail")
  };

  const parsed = logsQuerySchema.safeParse(query);
  if (!parsed.success) {
    return c.json({ message: "入力値が不正です。", issues: parsed.error.issues }, 400);
  }

  try {
    const snapshot = await readApplicationLogs(applicationId, parsed.data);
    return c.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "ログ取得に失敗しました。";
    if (message.includes("配備情報")) {
      return c.json({ message }, 404);
    }
    return c.json({ message: "ログ取得に失敗しました。", detail: message }, 500);
  }
});
