import express from 'express';
import { query } from '../db.js';

const router = express.Router();

// List shows with available seats count
router.get('/shows', async (req, res) => {
  try {
    const { date } = req.query;
    const params = [];
    let where = '';
    if (date) {
      params.push(date);
      where = 'WHERE s.start_time::date = $1';
    }
    const result = await query(
      `SELECT s.*,
              COALESCE(SUM(CASE WHEN t.status = 'available' THEN 1 ELSE 0 END), 0) AS available_seats,
              COALESCE(SUM(CASE WHEN t.status = 'booked' THEN 1 ELSE 0 END), 0) AS booked_seats,
              COALESCE(SUM(CASE WHEN t.status = 'held' THEN 1 ELSE 0 END), 0) AS held_seats
       FROM shows s
       LEFT JOIN seats t ON t.show_id = s.id
       ${where}
       ${where ? 'AND' : 'WHERE'} s.name NOT LIKE '[TEST]%'
       GROUP BY s.id
       ORDER BY s.start_time ASC`,
      params
    );
    return res.json({ shows: result.rows });
  } catch (err) {
    console.error('List shows failed', err);
    return res.status(500).json({ error: 'Failed to list shows' });
  }
});

// Seat map for a show
router.get('/shows/:id/seats', async (req, res) => {
  const showId = Number(req.params.id);
  if (!Number.isInteger(showId)) {
    return res.status(400).json({ error: 'Invalid show id' });
  }
  try {
    const showRes = await query('SELECT * FROM shows WHERE id = $1', [showId]);
    if (showRes.rowCount === 0) return res.status(404).json({ error: 'Show not found' });

    const seatsRes = await query(
      `SELECT seat_number, status FROM seats WHERE show_id = $1 ORDER BY seat_number ASC`,
      [showId]
    );
    const countsRes = await query(
      `SELECT
         SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) AS available,
         SUM(CASE WHEN status='booked' THEN 1 ELSE 0 END) AS booked,
         SUM(CASE WHEN status='held' THEN 1 ELSE 0 END) AS held
       FROM seats WHERE show_id = $1`,
      [showId]
    );
    return res.json({ show: showRes.rows[0], seats: seatsRes.rows, counts: countsRes.rows[0] });
  } catch (err) {
    console.error('List seats failed', err);
    return res.status(500).json({ error: 'Failed to list seats' });
  }
});

export default router;
