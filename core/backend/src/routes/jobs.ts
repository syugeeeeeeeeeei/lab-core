import { Hono } from "hono";
import { db } from "../lib/db.js";

export const jobsRouter = new Hono();

jobsRouter.get("/", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const jobs = db
    .prepare(
      `
        SELECT
          job_id,
          type,
          status,
          started_at,
          finished_at,
          message,
          related_application_id,
          created_at
        FROM jobs
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all(limit);

  return c.json({ jobs });
});
