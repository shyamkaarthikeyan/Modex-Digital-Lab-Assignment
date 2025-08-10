# Modex Digital Lab - Ticket Booking System

A modern ticket booking system developed by **Modex Digital Lab** that simulates core functionality of RedBus/BookMyShow with concurrency-safe seat booking. Supports creating shows, listing shows/seats, booking seats (immediate confirm) and optional holding with 2-minute expiry.

## Stack
- Node.js, Express.js
- Postgres (with transactional, atomic seat updates)
- Swagger docs at `/docs`

## Setup
1. Clone repo and install deps
```bash
npm install
```
2. Configure environment
```bash
cp .env.example .env
# edit .env to point DATABASE_URL to your Postgres
```
3. Create DB schema
```bash
npm run migrate
```
4. Start server
```bash
npm run dev
```

## API Overview
- `POST /admin/shows` — create a show with `name`, `startTime` (ISO), `totalSeats`.
- `GET /shows` — list shows with available seats count.
- `GET /shows/{id}/seats` — seat map for a show.
- `POST /bookings` — create a booking.
  - Body: `{ showId, seatNumbers: [1,2], mode: 'confirm' | 'hold' }`
  - `mode='confirm'` (default): atomically books if seats are available; returns `CONFIRMED` or `FAILED`.
  - `mode='hold'`: places a 2-minute hold (`PENDING` booking). Confirm via `POST /bookings/{id}/confirm`.
- `GET /bookings/{id}` — booking status.
- `POST /bookings/{id}/confirm` — confirm a held booking.

Swagger docs with request/response schemas available at `/docs`.

## Testing
```bash
# Test concurrency (multiple users booking same seats)
npm run test:concurrency

# Test booking expiry (held bookings expire after 2 minutes)
npm run test:expiry

# Test with shorter hold time (5 seconds)
$env:HOLD_TTL_MS=5000; npm run test:expiry  # Windows PowerShell
# or
HOLD_TTL_MS=5000 npm run test:expiry        # Linux/Mac
```

## Concurrency Guarantee
Seat booking uses a single SQL statement inside a transaction:

```sql
UPDATE seats SET status = 'booked', booking_id = $bookingId
WHERE show_id = $showId AND seat_number = ANY($seatNumbers) AND status = 'available'
RETURNING seat_number;
```

Because the update filters by `status = 'available'`, only one concurrent transaction can successfully change a seat from `available` to `booked`. The other transaction(s) will update zero rows for those seats and the API returns a `FAILED` booking, preventing overbooking.

Holds use the same pattern with `status = 'held'` and `hold_expires_at`. A background job runs every 30 seconds to auto-expire holds older than 2 minutes, releasing seats and marking the booking `FAILED`.

## Running a quick flow
1. Create a show
```bash
curl -X POST http://localhost:3000/admin/shows \
  -H 'Content-Type: application/json' \
  -d '{"name":"Bus A","startTime":"2025-08-09T18:00:00Z","totalSeats":40}'
```
2. List shows
```bash
curl http://localhost:3000/shows
```
3. Book seats 1 and 2
```bash
curl -X POST http://localhost:3000/bookings \
  -H 'Content-Type: application/json' \
  -d '{"showId":1,"seatNumbers":[1,2]}'
```

## Postman / Swagger
- Import `docs/openapi.yml` into Postman or open `http://localhost:3000/docs`.

## Development notes
- Database schema is in `db/schema.sql`. Run `npm run migrate` after changing it.
- Background expiry task is in `src/app.js`.

## License
MIT
