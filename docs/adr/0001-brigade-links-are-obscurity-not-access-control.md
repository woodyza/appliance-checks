# Brigade Links are obscurity, not access control

Running a Check needs no sign-in, because any login friction at the appliance means Checks get skipped. Each brigade instead gets a Brigade Link: a pseudo-random short slug, used almost entirely via the QR codes on its appliances. The slug is part of the Firestore document path, and anonymous list queries are limited to one brigade's path (Checks also to a recent date range), so one brigade can't stumble onto another's appliances. It isn't access control, though: anyone with the link can read and write that brigade's Checks. Editing Check Sheets, Monthly Reports and everything else require an authenticated Brigade Admin or VSO.

## Consequences

- An admin can rotate a leaked link, which invalidates the old URL and means reprinting that brigade's QR codes.
- Anonymous write rules have to be limited to Checks and validate their shape, because the rules are the only thing standing between a leaked link and the rest of the data.
