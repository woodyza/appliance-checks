# Early Check entry design

Lets a Check be started up to 2 days before its scheduled date. In practice people sometimes come in a day or two early, especially when Checks are due on a Monday. Today they can't: the app lands them on last week's Check, which is often already Complete, so an early visitor can quietly overwrite it. Builds on the check entry design (`2026-09-26-check-entry-design.md`). Terminology follows `CONTEXT.md`.

## Lead time

A Check opens 2 days before its scheduled date, so a Monday Check can be started from Saturday. The lead time is a fixed constant alongside `CHECK_TIME_ZONE`, the same for every brigade. A per-brigade setting was considered and left out until a brigade asks for one: it'd need a new field, admin UI, and a `get()` in the rules on every write.

The days between the upcoming Check opening and its scheduled date are the **early days**. During them, two Checks are open: the current one (still in its window) and the upcoming one.

## Default Check

1. Work out the default as now, from the real today. Call it D (usually last week's Check).
2. On an early day, if D's Check is Complete, the default is the upcoming Check.
3. Otherwise the default is D, even if it was never started.

So an incomplete Check stays in front of people until it's done, which makes it harder to miss. The cost: a week nobody ever starts is still the default for its early days, and people have to pick the upcoming Check from the selector (`?check=` then keeps them on it).

The existing "still in its window" rule (an existing Check dated after the current one, up to today, wins) stays bounded by the real today. Bounding it by the early-day horizon would let an already-started upcoming Check take the default while last week's is still incomplete.

Examples, Monday Check Day, Saturday 10 Oct:

| Mon 5 Oct | Mon 12 Oct | Default |
| --- | --- | --- |
| Complete | anything | 12 Oct |
| started, incomplete | anything | 5 Oct |
| never started | not started | 5 Oct |
| never started | started | 5 Oct |

On a day that isn't an early day, the default is unchanged.

## Selector

- On an early day, the selector also lists the upcoming Check.
- It starts from the 1st of whichever month is earlier: the current Check's or the default Check's. So on Sat 31 Oct, with the upcoming Check on Mon 2 Nov, an incomplete Mon 26 Oct is still listed.
- Existing Checks are listed up to the upcoming Check's date on an early day, otherwise up to today as now.

## Unchanged

These all keep using the real today:

- Frozen, including Frozen-by-window.
- `monthly` and Monthly Items, which follow the scheduled date (a Check opened on Sat 28 Nov for Mon 30 Nov still includes them).
- The weekly email, which reports the Check from 7 days ago.
- When the Monthly Report email is sent (`lastCheckOfMonth(today)`), so an early last-of-month Check doesn't send it before its Check Day.

The current month's Monthly Report may now include an existing upcoming Check's column with partial answers. That's fine.

## Firestore rules

The upper bound on `scheduledDate` goes from `request.time + 1d` to `request.time + 3d`. Rules work in UTC, so `+3d` always covers NZ today + 2, and sometimes allows a third day, which is harmless. A leaked Brigade Link can create Checks at most about 3 days ahead.

## Doc changes

`CONTEXT.md`: a **Check** opens 2 days before its scheduled date. No ADR changes.

## Testing

- **Unit, default Check:**
  - an early day, last week's Complete → upcoming
  - an early day, last week's incomplete or never started → last week's
  - an early day, upcoming already started, last week's incomplete → last week's
  - not an early day → unchanged
- **Unit, selector:** on an early day it includes the upcoming Check; Sat 31 Oct with a Monday Check Day still lists 26 Oct.
- **Rules:** a Check dated NZ today + 2 is accepted, and NZ today + 4 is rejected.

## Out of scope

A per-brigade lead time; a nudge on the upcoming Check that last week's isn't Complete.
