import express from 'express';
import { getClient, query } from '../db.js';
import { requireAuth } from './auth.js';

const router = express.Router();
// Configurable hold TTL (defaults to 2 minutes)
const HOLD_TTL_MS = Number(process.env.HOLD_TTL_MS || 120000);

// Get all bookings for the current user
router.get('/bookings', requireAuth('user'), async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        b.id,
        b.status,
        b.created_at,
        b.updated_at,
        s.name as show_name,
        s.start_time,
        COUNT(seats.seat_number) as seat_count,
        STRING_AGG(seats.seat_number::text, ', ' ORDER BY seats.seat_number) as seat_numbers
      FROM bookings b
      JOIN shows s ON s.id = b.show_id
      LEFT JOIN seats ON seats.booking_id = b.id
      GROUP BY b.id, b.status, b.created_at, b.updated_at, s.name, s.start_time
      ORDER BY b.created_at DESC`
    );
    
    return res.json({ bookings: result.rows });
  } catch (err) {
    console.error('Get user bookings failed', err);
    return res.status(500).json({ error: 'Failed to get bookings' });
  }
});

// Create a booking. mode: 'confirm' (default) or 'hold'
router.post('/bookings', requireAuth('user'), async (req, res) => {
  const { showId, seatNumbers, mode } = req.body || {};
  if (!Number.isInteger(showId) || !Array.isArray(seatNumbers) || seatNumbers.length === 0) {
    return res.status(400).json({ error: 'showId (int) and seatNumbers (non-empty array) are required' });
  }
  const normalizedSeats = [...new Set(seatNumbers.map(Number))].filter(Number.isInteger);
  if (normalizedSeats.length !== seatNumbers.length) {
    return res.status(400).json({ error: 'seatNumbers must be integers and unique' });
  }
  const isHold = mode === 'hold';

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Ensure show exists and seat numbers are within range
    const showRes = await client.query('SELECT id, total_seats, start_time FROM shows WHERE id = $1', [showId]);
    if (showRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Show not found' });
    }
    const totalSeats = showRes.rows[0].total_seats;
    // booking open only for next 5 days
    const startTime = new Date(showRes.rows[0].start_time);
    const now = new Date();
    const max = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    if (!(startTime > now && startTime <= max)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Booking open only for trips in the next 5 days' });
    }
    if (normalizedSeats.some((n) => n < 1 || n > totalSeats)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `seatNumbers must be between 1 and ${totalSeats}` });
    }

    // Create booking in PENDING first
    const bookingRes = await client.query(
      'INSERT INTO bookings (show_id, status) VALUES ($1, $2) RETURNING *',
      [showId, 'PENDING']
    );
    const booking = bookingRes.rows[0];

    if (isHold) {
      // Atomically hold seats if available or previously held but expired
      const holdExpiresAt = new Date(Date.now() + HOLD_TTL_MS);
      const holdRes = await client.query(
        `UPDATE seats SET status = 'held', booking_id = $1, hold_expires_at = $4, updated_at = NOW()
         WHERE show_id = $2 AND seat_number = ANY($3)
           AND (
             status = 'available' OR (status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW())
           )
         RETURNING seat_number`,
        [booking.id, showId, normalizedSeats, holdExpiresAt]
      );
      if (holdRes.rowCount !== normalizedSeats.length) {
        // Not all seats could be held -> fail booking
        await client.query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2', ['FAILED', booking.id]);
        await client.query('COMMIT');
        return res.status(409).json({
          booking: { id: booking.id, status: 'FAILED' },
          message: 'Some seats are not available',
          heldSeats: holdRes.rows.map((r) => r.seat_number),
        });
      }
      // Determine expiry for UI timer
      const expRes = await client.query(
        `SELECT MAX(hold_expires_at) AS expires_at FROM seats WHERE booking_id = $1 AND status = 'held'`,
        [booking.id]
      );
      const expiresAt = expRes.rows[0]?.expires_at || null;
      await client.query('COMMIT');
      return res.status(201).json({ booking: { id: booking.id, status: 'PENDING' }, heldSeats: normalizedSeats, expiresAt });
    } else {
      // Direct confirm: atomically book seats if available or previously held but expired
      const updRes = await client.query(
        `UPDATE seats SET status = 'booked', booking_id = $1, hold_expires_at = NULL, updated_at = NOW()
         WHERE show_id = $2 AND seat_number = ANY($3)
           AND (
             status = 'available' OR (status = 'held' AND hold_expires_at IS NOT NULL AND hold_expires_at < NOW())
           )
         RETURNING seat_number`,
        [booking.id, showId, normalizedSeats]
      );
      if (updRes.rowCount !== normalizedSeats.length) {
        // Not all seats available -> fail
        await client.query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2', ['FAILED', booking.id]);
        await client.query('COMMIT');
        return res.status(409).json({
          booking: { id: booking.id, status: 'FAILED' },
          message: 'Some seats are not available',
          bookedSeats: updRes.rows.map((r) => r.seat_number),
        });
      }
      await client.query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2', ['CONFIRMED', booking.id]);
      await client.query('COMMIT');
      return res.status(201).json({ booking: { id: booking.id, status: 'CONFIRMED' }, bookedSeats: normalizedSeats });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create booking failed', err);
    return res.status(500).json({ error: 'Failed to create booking' });
  } finally {
    client.release();
  }
});

// Confirm a held (PENDING) booking
router.post('/bookings/:id/confirm', requireAuth('user'), async (req, res) => {
  const bookingId = Number(req.params.id);
  if (!Number.isInteger(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const bRes = await client.query('SELECT id, status, show_id FROM bookings WHERE id = $1 FOR UPDATE', [bookingId]);
    if (bRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    const booking = bRes.rows[0];
    if (booking.status !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Booking is not PENDING (status=${booking.status})` });
    }

    // Ensure held seats haven't expired
    const heldSeatsRes = await client.query(
      `SELECT seat_number FROM seats WHERE booking_id = $1 AND status = 'held' AND (hold_expires_at IS NULL OR hold_expires_at > NOW())`,
      [bookingId]
    );
    if (heldSeatsRes.rowCount === 0) {
      // No valid holds -> fail
      await client.query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2', ['FAILED', bookingId]);
      await client.query('COMMIT');
      return res.status(409).json({ error: 'Held seats expired or missing', booking: { id: bookingId, status: 'FAILED' } });
    }

    // Confirm seats atomically
    const updRes = await client.query(
      `UPDATE seats SET status = 'booked', hold_expires_at = NULL, updated_at = NOW()
       WHERE booking_id = $1 AND status = 'held' AND (hold_expires_at IS NULL OR hold_expires_at > NOW())`,
      [bookingId]
    );

    await client.query('UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2', ['CONFIRMED', bookingId]);
    await client.query('COMMIT');
    return res.json({ booking: { id: bookingId, status: 'CONFIRMED' }, bookedSeats: heldSeatsRes.rows.map(r => r.seat_number) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Confirm booking failed', err);
    return res.status(500).json({ error: 'Failed to confirm booking' });
  } finally {
    client.release();
  }
});

// Get booking status
router.get('/bookings/:id', async (req, res) => {
  const bookingId = Number(req.params.id);
  if (!Number.isInteger(bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
  try {
    const bRes = await query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
    if (bRes.rowCount === 0) return res.status(404).json({ error: 'Not found' });

    const seatsRes = await query('SELECT seat_number, status, hold_expires_at FROM seats WHERE booking_id = $1', [bookingId]);
    const expRes = await query(
      `SELECT MAX(hold_expires_at) AS expires_at FROM seats WHERE booking_id = $1 AND status = 'held'`,
      [bookingId]
    );
    return res.json({ booking: bRes.rows[0], seats: seatsRes.rows, expiresAt: expRes.rows[0]?.expires_at || null });
  } catch (err) {
    console.error('Get booking failed', err);
    return res.status(500).json({ error: 'Failed to get booking' });
  }
});

export default router;
