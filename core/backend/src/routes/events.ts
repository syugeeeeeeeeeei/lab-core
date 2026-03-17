import { Hono } from "hono";
import { db } from "../lib/db.js";

export const eventsRouter = new Hono();

eventsRouter.get("/", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 300);
  const applicationId = c.req.query("applicationId");

  if (applicationId) {
    const events = db
      .prepare(
        `
          SELECT event_id, scope, application_id, level, title, message, created_at
          FROM system_events
          WHERE application_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `
      )
      .all(applicationId, limit);

    return c.json({ events });
  }

  const events = db
    .prepare(
      `
        SELECT event_id, scope, application_id, level, title, message, created_at
        FROM system_events
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all(limit);

  return c.json({ events });
});
