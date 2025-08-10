import express from 'express';
import { getClient } from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();

// Create a show and materialize its seats
router.post('/shows', requireAuth('admin'), async (req, res) => {
  const { name, startTime, totalSeats } = req.body || {};
  if (!name || !startTime || !totalSeats || totalSeats <= 0) {
    return res.status(400).json({ error: 'name, startTime (ISO), totalSeats (>0) are required' });
  }
  // Enforce only next 5 days scheduling
  const start = new Date(startTime);
  const now = new Date();
  const max = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  if (!(start > now && start <= max)) {
    return res.status(400).json({ error: 'Trips can only be scheduled within the next 5 days' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const showResult = await client.query(
      'INSERT INTO shows (name, start_time, total_seats) VALUES ($1, $2, $3) RETURNING *',
      [name, new Date(startTime), totalSeats]
    );
    const show = showResult.rows[0];

    // Insert seats 1..N using generate_series
    await client.query(
      `INSERT INTO seats (show_id, seat_number)
       SELECT $1, gs FROM generate_series(1, $2) AS gs`,
      [show.id, totalSeats]
    );

    await client.query('COMMIT');
    return res.status(201).json({ show });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create show failed', err);
    return res.status(500).json({ error: 'Failed to create show' });
  } finally {
    client.release();
  }
});

export default router;

// Delete a show (optional admin action)
router.delete('/shows/:id', requireAuth('admin'), async (req, res) => {
  const showId = Number(req.params.id);
  if (!Number.isInteger(showId)) return res.status(400).json({ error: 'Invalid show id' });
  const client = await getClient();
  try {
    const result = await client.query('DELETE FROM shows WHERE id = $1', [showId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Show not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('Delete show failed', err);
    return res.status(500).json({ error: 'Failed to delete show' });
  } finally {
    client.release();
  }
});
