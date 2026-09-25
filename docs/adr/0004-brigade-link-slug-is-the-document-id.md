# Brigade Link slug is the document id, and rotation moves the data

A brigade is stored at `brigades/{slug}`: the Brigade Link slug is the Firestore document id itself, not a field on a document keyed by something else. A brigade also has a separate, stable `brigadeId`, generated once and never changed, for anything that needs to reference the brigade independently of its current link (e.g. future cross-brigade reporting).

Rotating a leaked Brigade Link (ADR 0001) therefore means copying the brigade's data to a new `brigades/{newSlug}` document and deleting the old one, rather than updating a field in place. The `brigadeId` travels with the data unchanged, so anything that referenced it keeps working; anything that referenced the old slug (old QR codes) stops, which is the point.

## Considered Options

- **Slug as a field, brigade keyed by `brigadeId`**: rotation becomes a single field update, but an anonymous client holding only a slug would need a readable `slug -> brigadeId` lookup to reach the brigade at all. That lookup document would hand out the `brigadeId` itself, which then becomes a permanent secret no rotation can revoke (or every rule would need an `exists()` check against the live slug mapping, adding a second thing to keep consistent).
- **Slug as the document id (chosen)**: anonymous rules stay a simple path match; rotation costs a copy-and-delete instead of a field update.
