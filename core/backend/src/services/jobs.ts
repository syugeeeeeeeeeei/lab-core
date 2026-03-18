import { nanoid } from "nanoid";
import { db, nowIso } from "../lib/db.js";
import type { JobStatus, JobType } from "../types.js";

const createJobStatement = db.prepare(`
  INSERT INTO jobs (
    job_id,
    type,
    status,
    started_at,
    finished_at,
    message,
    related_application_id,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateJobStatusStatement = db.prepare(`
  UPDATE jobs
  SET status = ?, started_at = COALESCE(started_at, ?), finished_at = ?, message = ?
  WHERE job_id = ?
`);

const updateJobMessageStatement = db.prepare(`
  UPDATE jobs
  SET status = 'running', started_at = COALESCE(started_at, ?), message = ?, finished_at = NULL
  WHERE job_id = ?
`);

export function createJob(type: JobType, applicationId?: string, message?: string): string {
  const jobId = nanoid();
  createJobStatement.run(jobId, type, "queued", null, null, message ?? null, applicationId ?? null, nowIso());
  return jobId;
}

export function startJob(jobId: string, message?: string): void {
  updateJobStatusStatement.run("running", nowIso(), null, message ?? null, jobId);
}

export function finishJob(jobId: string, status: Extract<JobStatus, "succeeded" | "failed">, message: string): void {
  updateJobStatusStatement.run(status, nowIso(), nowIso(), message, jobId);
}

export function setJobProgress(jobId: string, message: string): void {
  updateJobMessageStatement.run(nowIso(), message, jobId);
}
