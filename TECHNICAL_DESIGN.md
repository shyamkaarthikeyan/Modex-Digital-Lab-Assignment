## High-level Architecture
- **API Layer (Express)**: Handles HTTP requests, input validation, routing, and returns JSON responses. Serves Swagger docs at `/docs`.
- **Application Logic**: Implements show creation, listing, and booking workflows, including optional holds and confirmation.
- **Data Layer (Postgres)**: Persist shows, seats, and bookings. Concurrency control is implemented at the database level using row-level updates in transactions.
- **Background Worker**: A lightweight in-process interval that expires stale holds (>2 minutes), releasing seats and marking bookings as `FAILED`.

## Database Design
- `shows(id, name, start_time, total_seats, created_at)`
- `seats(id, show_id, seat_number, status, booking_id, hold_expires_at, updated_at)`
  - `UNIQUE(show_id, seat_number)` ensures a single row per seat per show.
  - `status ∈ {available, held, booked}`
- `bookings(id, show_id, status, created_at, updated_at)`
  - `status ∈ {PENDING, CONFIRMED, FAILED}`

### Why materialize `seats`
- Enables straightforward, row-level concurrency control with transactional updates.
- Efficient queries for availability and seat maps.

## Concurrency Control
- Atomic seat acquisition via a single `UPDATE ... WHERE status='available'` statement inside a transaction. If competing requests target the same seat(s), only one succeeds; others observe zero updated rows and the booking is marked `FAILED`. This eliminates race conditions and overbooking.
- Optional holds use `status='held'` and `hold_expires_at`, providing a two-phase booking: hold then confirm. Expiry runs periodically.
- Additional safeguards:
  - Foreign keys and uniqueness constraints maintain integrity.
  - Transactions wrap booking operations; on any error, a rollback prevents partial state.

## Scaling Strategy
- **API**: Stateless services behind a load balancer. Horizontal scale instances.
- **Database**:
  - Start with a single primary and read replicas. Route read-only queries (list shows/seats) to replicas.
  - Use connection pooling (PgBouncer) for many short-lived connections.
  - Partitioning/sharding by `show_id` for very large datasets; `seats` naturally partitions by show.
  - Consider separate logical databases per region to keep data close to users.
- **Caching**:
  - Cache read-heavy endpoints (e.g., `/shows`, seat maps) in Redis with short TTL, invalidated on seat updates or show changes.
  - Use HTTP caching headers for list endpoints.
- **Queues / Async Processing**:
  - Use a message queue (e.g., Kafka/SQS/RabbitMQ) for decoupling: send booking events (`BOOKING_CONFIRMED/FAILED`) for downstream services (notifications, analytics, invoicing).
  - Background workers process expiry and other async tasks outside the API lifecycle.
- **Observability**:
  - Centralized structured logging, application metrics (latency, error rate), and tracing.
  - Database dashboards for locks, slow queries, replication lag.

## Failure Handling and Consistency
- All booking operations are transactional and idempotent at the seat level.
- Retries are safe; a second identical request will either confirm the same seats (if held) or fail if unavailable.
- In distributed deployments, rely on the database as the source of truth for seat state; avoid caching writes.

## Security and Access Control
- Separate admin endpoints under `/admin` (add authentication in production).
- Validate inputs and limit payload sizes.

## Future Enhancements
- Payment integration with pending holds and webhook-based confirmation.
- Dedicated worker service for expiry, using a reliable queue and schedulers.
- Batch APIs and pagination for large seat maps.
- Rate limiting and circuit breakers.
