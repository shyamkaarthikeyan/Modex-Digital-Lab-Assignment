import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import adminRoutes from './routes/admin.js';
import showRoutes from './routes/shows.js';
import bookingRoutes from './routes/bookings.js';
import authRoutes from './routes/auth.js';
import { getClient } from './db.js';

dotenv.config();

const app = express();
app.use(express.json());

// Swagger docs
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiSpec = YAML.load(path.join(__dirname, '..', 'docs', 'openapi.yml'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(apiSpec));

// Static UI with no-cache headers for development
app.use('/styles.css', (req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use('/app.js', (req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use('/index.html', (req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/', showRoutes);
app.use('/', bookingRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Background task: expire held bookings older than configured hold TTL (default 2 minutes)
async function expireStaleHolds() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Find bookings that are PENDING and have held seats expired
    const staleBookings = await client.query(
      `SELECT b.id FROM bookings b
       WHERE b.status = 'PENDING' 
       AND EXISTS (
         SELECT 1 FROM seats s 
         WHERE s.booking_id = b.id 
         AND s.status = 'held' 
         AND s.hold_expires_at < NOW()
       )
       FOR UPDATE OF b`
    );

    if (staleBookings.rowCount > 0) {
      const ids = staleBookings.rows.map((r) => r.id);
      await client.query(
        `UPDATE seats SET status = 'available', booking_id = NULL, hold_expires_at = NULL, updated_at = NOW()
         WHERE booking_id = ANY($1) AND status = 'held'`,
        [ids]
      );
      await client.query(
        `UPDATE bookings SET status = 'FAILED', updated_at = NOW()
         WHERE id = ANY($1)`,
        [ids]
      );
      console.log('Expired holds for bookings:', ids);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Expire holds task failed', err);
  } finally {
    client.release();
  }
}

setInterval(expireStaleHolds, 30_000);

export default app;
