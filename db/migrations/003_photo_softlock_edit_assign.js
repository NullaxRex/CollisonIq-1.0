'use strict';

function runMigration(db) {
  // New columns on jobs
  const jobCols = [
    "photo_status TEXT DEFAULT 'red'",
    'photo_status_override INTEGER DEFAULT 0',
    'closed_by INTEGER',
    'closed_at TEXT',
    'last_edited_by INTEGER',
    'last_edited_at TEXT',
  ];
  for (const col of jobCols) {
    try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col}`); } catch (e) {}
  }

  // Job assignments table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_assignments (
        job_id      TEXT    NOT NULL,
        user_id     INTEGER NOT NULL,
        assigned_by INTEGER,
        assigned_at TEXT    DEFAULT (datetime('now')),
        PRIMARY KEY (job_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_job_assignments_job ON job_assignments(job_id);
    `);
  } catch (e) {}
}

module.exports = { runMigration };
