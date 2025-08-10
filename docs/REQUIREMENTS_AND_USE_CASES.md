## Functional Requirements
- **Show/Trip Management**: Admin can create shows/trips with `name`, `start_time`, `total_seats`.
- **List Shows/Trips**: Users can view available shows with remaining seats.
- **Seat Map**: Users can view seat status per show.
- **Booking**: Users can request one or more seat numbers for a show.
- **Status Lifecycle**: Booking status is one of `PENDING`, `CONFIRMED`, `FAILED`.
- **Concurrency Safety**: Multiple simultaneous bookings for the same seat(s) must not overbook.
- **(Bonus) Expiry**: Auto-fail bookings that remain `PENDING` beyond 2 minutes (holds).

## Use Cases and Acceptance Criteria
- **UC1: Admin creates a show**
  - Input: `name`, `startTime` (ISO), `totalSeats` (>0)
  - Output: 201 with created show; seats 1..N are materialized as `available`.
  - Errors: 400 for invalid input.

- **UC2: User lists shows**
  - Input: none
  - Output: 200 with shows sorted by `start_time` and `available_seats` count.

- **UC3: User views seat map**
  - Input: `showId`
  - Output: 200 with `seat_number` and `status` for that show.
  - Errors: 404 if show not found.

- **UC4: User books seats (immediate confirm)**
  - Input: `showId`, `seatNumbers` (unique array of integers)
  - Behavior: Atomically update seats to `booked` if all are `available` (or held but expired).
  - Output: 201 with `booking.status = CONFIRMED` and `bookedSeats` on success.
  - Failure: 409 with `booking.status = FAILED` if any requested seat is not available.

- **UC5: User holds seats (optional two-step)**
  - Input: `showId`, `seatNumbers`, `mode='hold'`
  - Behavior: Atomically set seats to `held` with `hold_expires_at = now()+2m` if available.
  - Output: 201 with `booking.status = PENDING` and `heldSeats` on success.
  - Failure: 409 with `booking.status = FAILED` if any requested seat not available.

- **UC6: User confirms a held booking**
  - Input: `bookingId`
  - Behavior: If seats are still held and not expired, set to `booked` and booking to `CONFIRMED`.
  - Output: 200 with `bookedSeats` and `booking.status = CONFIRMED`.
  - Errors: 400 if booking not `PENDING`; 409 if holds expired; 404 if not found.

- **UC7: System expires stale holds (bonus)**
  - Trigger: Background job every 30s
  - Behavior: Seats with `status='held'` and `hold_expires_at < now()` are released to `available`; associated `PENDING` bookings set to `FAILED`.

## Non-Functional / Concurrency Guarantees
- **Atomicity**: Seat acquisition uses a single transactional `UPDATE ... WHERE status='available' OR held-expired` guarded by predicates. Only one concurrent transaction can win per seat.
- **Isolation**: Postgres row-level updates ensure competing transactions do not overbook; losers update 0 rows and booking is marked `FAILED`.
- **Durability**: All writes are persisted via Postgres; partial failures roll back the transaction.

## API Mapping
- `POST /admin/shows` → UC1
- `GET /shows` → UC2
- `GET /shows/{id}/seats` → UC3
- `POST /bookings` (default `mode=confirm`) → UC4
- `POST /bookings` with `mode=hold` → UC5
- `POST /bookings/{id}/confirm` → UC6
- Background expiry task → UC7
