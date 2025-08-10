import fetch from 'node-fetch';

const BASE = process.env.BASE || 'http://localhost:3000';

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
    body: JSON.stringify({ name: '[TEST] Bus Concurrency', startTime, totalSeats: 5 }),
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

async function attemptSameSeatCollisions(userToken, showId, seatNumber, numRequests = 10) {
  const payload = JSON.stringify({ showId, seatNumbers: [seatNumber] });
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` };
  const promises = Array.from({ length: numRequests }).map(() =>
    fetch(`${BASE}/bookings`, { method: 'POST', headers, body: payload }).then(async (r) => ({ status: r.status, body: await r.json() }))
  );
  const results = await Promise.all(promises);
  const confirmed = results.filter((r) => r.body.booking?.status === 'CONFIRMED');
  const failed = results.filter((r) => r.body.booking?.status === 'FAILED');
  console.log(`Collisions on seat ${seatNumber}: confirmed=${confirmed.length}, failed=${failed.length}`);
  if (confirmed.length !== 1) {
    console.error('Expected exactly 1 confirmed booking for the same seat');
    process.exit(2);
  }
}

async function attemptManySeats(userToken, showId) {
  // Use seats 2-5 since seat 1 was used in collision test
  const seats = [2, 3, 4, 5];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` };
  const promises = seats.map((seat) =>
    fetch(`${BASE}/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ showId, seatNumbers: [seat] })
    }).then(async (r) => ({ status: r.status, body: await r.json() }))
  );
  const results = await Promise.all(promises);
  const confirmed = results.filter((r) => r.body.booking?.status === 'CONFIRMED');
  const failed = results.filter((r) => r.body.booking?.status === 'FAILED');
  console.log('Distinct seat bookings -> confirmed:', confirmed.length, 'failed:', failed.length);
  if (confirmed.length !== seats.length) {
    console.error('Expected all distinct seats to be confirmed, but got:', {
      confirmed: confirmed.map(r => r.body),
      failed: failed.map(r => r.body)
    });
    process.exit(3);
  }
}

(async () => {
  const adminToken = await login('admin', 'admin123');
  const userToken = await login('user', 'user123');
  const showId = await createShow(adminToken);

  try {
    // Test collision: multiple attempts on the same seat
    await attemptSameSeatCollisions(userToken, showId, 1, 10);

    // Test different seats concurrently
    await attemptManySeats(userToken, showId);

    console.log('Concurrency tests passed.');
  } finally {
    // Cleanup test show
    await cleanupShow(adminToken, showId);
  }
})();
