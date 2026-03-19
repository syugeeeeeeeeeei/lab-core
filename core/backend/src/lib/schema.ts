import type Database from "better-sqlite3";

function ensureColumn(db: Database.Database, tableName: string, columnName: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      application_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      repository_url TEXT NOT NULL,
      default_branch TEXT NOT NULL DEFAULT 'main',
      current_commit TEXT,
      previous_commit TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deployments (
      deployment_id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL UNIQUE,
      compose_path TEXT NOT NULL,
      public_service_name TEXT NOT NULL,
      public_port INTEGER NOT NULL,
      hostname TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      keep_volumes_on_rebuild INTEGER NOT NULL DEFAULT 1,
      device_requirements TEXT NOT NULL DEFAULT '[]',
      env_overrides TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(application_id) REFERENCES applications(application_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS container_instances (
      container_id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      runtime_name TEXT NOT NULL,
      health_state TEXT NOT NULL,
      restart_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(application_id) REFERENCES applications(application_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS routes (
      route_id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      hostname TEXT NOT NULL,
      upstream_container TEXT,
      upstream_port INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(application_id, hostname),
      FOREIGN KEY(application_id) REFERENCES applications(application_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_events (
      event_id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      application_id TEXT,
      level TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(application_id) REFERENCES applications(application_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS update_info (
      application_id TEXT PRIMARY KEY,
      current_commit TEXT,
      latest_remote_commit TEXT,
      has_update INTEGER NOT NULL DEFAULT 0,
      checked_at TEXT NOT NULL,
      FOREIGN KEY(application_id) REFERENCES applications(application_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      message TEXT,
      related_application_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(related_application_id) REFERENCES applications(application_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_system_events_created_at ON system_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at ON jobs(status, created_at DESC);
  `);

  ensureColumn(db, "deployments", "env_overrides", "TEXT NOT NULL DEFAULT '{}'");
}
