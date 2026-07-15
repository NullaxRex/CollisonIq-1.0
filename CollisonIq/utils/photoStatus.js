'use strict';

/**
 * Calculate photo documentation status for a collision job.
 *
 * @param {Array} jobPhotoRows - rows from job_photos table for this job
 * @returns {'green'|'yellow'|'red'}
 *   green  — all required Layer 1 AND Layer 2 photos uploaded
 *   yellow — all required Layer 1 photos uploaded; Layer 2 incomplete (or has no required L2)
 *   red    — one or more required Layer 1 photos missing
 */
function calculatePhotoStatus(jobPhotoRows) {
  const l1Required = jobPhotoRows.filter(r => r.layer === 1 && !r.is_recommended);
  const l1Filled   = l1Required.filter(r => r.file_path);
  const l2Required = jobPhotoRows.filter(r => r.layer === 2 && !r.is_recommended);
  const l2Filled   = l2Required.filter(r => r.file_path);

  const l1Complete = l1Required.length > 0 && l1Filled.length === l1Required.length;
  const l2Complete = l2Required.length === 0 || l2Filled.length === l2Required.length;

  if (l1Complete && l2Complete) return 'green';
  if (l1Complete) return 'yellow';
  return 'red';
}

/**
 * Recalculate and persist photo_status for a job.
 *
 * @param {object} db  - DatabaseSync instance
 * @param {string} jobId - jobs.jobId value
 * @returns {'green'|'yellow'|'red'} the new status
 */
function updateJobPhotoStatus(db, jobId) {
  const rows   = db.prepare(`SELECT layer, is_recommended, file_path FROM job_photos WHERE job_id=?`).all(jobId);
  const status = calculatePhotoStatus(rows);
  db.prepare(`UPDATE jobs SET photo_status=? WHERE jobId=?`).run(status, jobId);
  return status;
}

module.exports = { calculatePhotoStatus, updateJobPhotoStatus };
