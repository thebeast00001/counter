# The storage ceiling

The one scaling problem this app has that is not solved. Written down because it
is invisible until it is urgent, and because the mitigations already in place
make it *look* solved.

## The shape of it

A business is stored as a **single sealed JSON value** in AsyncStorage under
`os.business.data`. Measured against seeded data, that is roughly **155 bytes per
engagement**:

| engagements | blob   | roughly                             |
| ----------- | ------ | ----------------------------------- |
| 1,000       | 155 KB | a few months of a small studio      |
| 10,000      | 1.5 MB | a year of a busy one                |
| 40,000      | ~6 MB  | **the old AsyncStorage ceiling**    |
| 100,000     | 15 MB  | a 500-member gym, about three years |
| 500,000     | 75 MB  | not survivable in this design       |

Three separate costs grow with that number, and only one of them is obvious:

1. **Cold start** — `JSON.parse` plus an AES-GCM decrypt of the whole value.
2. **Every write** — the whole value is re-serialised, re-encrypted and
   re-written, because the unit of storage is the business rather than the
   record. A change of one byte costs the size of the ledger.
3. **Every render** — `buildIndex` walks the entire record set. This is
   deliberate and is what makes every insight possible without a query layer,
   but it is linear in the size of the business.

## What has been done

- **The ceiling was raised to 128 MB** (`plugins/withAsyncStorageSize.js`). The
  Android default of 6 MB was reachable by a real gym inside two years, and
  crossing it means writes fail while the owner sees no error.
- **Writes are coalesced** (`state/persist.ts`). Ticking fourteen people off a
  register was fourteen full serialise-encrypt-write cycles; it is now one.
  Pending work is flushed when the app backgrounds, so the window cannot lose
  anything to a process kill.

Both buy time. Neither changes the shape.

## What actually fixes it

Stop storing the business as one value. `expo-sqlite` with a table per
collection, so that:

- a write touches one row rather than the whole ledger,
- a cold start reads what a screen needs rather than everything,
- and `buildIndex` is replaced by queries — or kept for the derivation layer but
  fed a bounded window rather than all history.

The third point is the hard one and the reason this has not been done casually.
`buildIndex` over the complete record set is the foundation every insight,
forecast and finding is built on; making it incremental or windowed is a change
to the intelligence layer, not to a storage adapter. `scripts/edge-check.mjs`
exists partly to make that migration survivable — it runs the whole domain layer
over six fixtures and fails on a throw, a `NaN`, or an `Infinity`.

## When to do it

Before any real customer accumulates two years of history. The measurement to
watch is the size of the stored value, not the number of users — a thousand
small businesses are fine, and one large one is not.
