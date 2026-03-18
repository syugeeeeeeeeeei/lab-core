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
          SELECT se.event_id, se.scope, se.application_id, a.name AS application_name, se.level, se.title, se.message, se.created_at
          FROM system_events se
          LEFT JOIN applications a ON a.application_id = se.application_id
          WHERE se.application_id = ?
          ORDER BY se.created_at DESC
          LIMIT ?
        `
      )
      .all(applicationId, limit);

    return c.json({ events });
  }

  const events = db
    .prepare(
      `
        SELECT se.event_id, se.scope, se.application_id, a.name AS application_name, se.level, se.title, se.message, se.created_at
        FROM system_events se
        LEFT JOIN applications a ON a.application_id = se.application_id
        ORDER BY se.created_at DESC
        LIMIT ?
      `
    )
    .all(limit);

  return c.json({ events });
});
