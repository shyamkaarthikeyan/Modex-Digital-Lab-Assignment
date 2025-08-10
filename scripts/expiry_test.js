import fetch from 'node-fetch';

const BASE = process.env.BASE || 'http://localhost:3000';
const HOLD_TTL_MS = Number(process.env.HOLD_TTL_MS || 5000);

async function login(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Login failed: ${JSON.stringify(data)}`);
  return data.token;
}

async function createShow(adminToken) {
  const startTime = new Date(Date.now() + 60_000).toISOString();
  const res = await fetch(`${BASE}/admin/shows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ name: '[TEST] Expiry Test', startTime, totalSeats: 3 })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Create show failed: ${JSON.stringify(data)}`);
  return data.show.id;
}

async function cleanupShow(adminToken, showId) {
  try {
    await fetch(`${BASE}/admin/shows/${showId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
  } catch (error) {
    console.warn('Failed to cleanup test show:', showId);
  }
}

async function holdBooking(userToken, showId) {
  const res = await fetch(`${BASE}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ showId, seatNumbers: [1, 2], mode: 'hold' })
  });
(async () => {
  const adminToken = await login('admin', 'admin123');
  const userToken = await login('user', 'user123');

  const showId = await createShow(adminToken);
  const bookingId = await holdBooking(userToken, showId);
  console.log('Held booking id:', bookingId, 'waiting', HOLD_TTL_MS + 35_000, 'ms for expiry...');

  try {
    // Wait longer than HOLD_TTL + interval (setInterval is 30s) + buffer
    const waitMs = HOLD_TTL_MS + 40_000; // Extra buffer for processing
    await new Promise((resolve) => setTimeout(resolve, waitMs));

    const { ok, data } = await getBooking(bookingId);
    if (!ok) {
      console.error('Fetch booking failed', data);
      process.exit(1);
    }
    console.log('Booking status:', data.booking.status);
    if (data.booking.status !== 'FAILED') {
      console.error('Expected booking to be FAILED after expiry');
      process.exit(2);
    }
    console.log('Expiry test passed.');
  } finally {
    // Cleanup test show
    await cleanupShow(adminToken, showId);
  }
})();st { ok, data } = await getBooking(bookingId);
  if (!ok) {
    console.error('Fetch booking failed', data);
    process.exit(1);
  }
  console.log('Booking status:', data.booking.status);
  if (data.booking.status !== 'FAILED') {
    console.error('Expected booking to be FAILED after expiry');
    process.exit(2);
  }
  console.log('Expiry test passed.');
})();
