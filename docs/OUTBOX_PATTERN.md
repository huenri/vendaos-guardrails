# Race-safe outbox integration

The guardrail decision and the side effect must share a concurrency boundary. Otherwise two workers
can both observe the same contact history, both receive `allow`, and exceed a frequency limit.

[`examples/race-safe-outbox.mjs`](../examples/race-safe-outbox.mjs) provides a database-neutral
reference flow. Its `store` and `transaction` methods are contracts for the host application; the
package does not pretend that an in-memory example is durable or production-safe.

## Required transaction properties

The host should execute these operations under a serializable transaction, a customer-scoped lock,
or an equivalent atomic mechanism:

1. Load authoritative consent, opt-out state, time zone, and contact history.
2. Build a new allow-listed `SalesAction`; do not spread agent-owned objects into it.
3. Parse and evaluate the candidate with the pinned policy version.
4. Atomically consume an applicable approval nonce using a unique constraint or compare-and-set.
5. Append a minimized audit record.
6. Insert the immutable outbound payload and action fingerprint into an outbox only for `allow`.
7. Commit all state together.

The channel worker must send only committed outbox rows. It should use the outbox ID or action ID as
an idempotency key and must not regenerate message content, discounts, recipients, or policy state.

## Suggested uniqueness constraints

- approval nonce: unique within the approval-key or tenant scope until at least token expiry;
- outbox idempotency key: unique within the tenant and channel;
- action ID: unique within the tenant;
- audit sequence: unique within the selected audit stream.

Never claim that a process-local `Set`, mutex, or queue protects multiple processes. Those tools are
useful in tests, but production replay and race prevention belong in the durable host transaction.
