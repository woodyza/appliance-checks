# Brigade QR code PDF design

Lets an admin download a printable PDF with one QR code for the brigade's Brigade Link, and drops the per-appliance QR link from the Appliance admin page. In practice a brigade puts up one QR code in the engine bay, not one per appliance: it's simpler and means less printing. Picks up "generating QR code images", which the Check Sheet editor design left out of scope. Terminology follows `CONTEXT.md`.

## Brigade admin page

A "QR code" block at the bottom of the Details panel on `/:slug/admin`: one line of help ("Print this and put it up where Checks start, e.g. the engine bay.") and a **Download PDF** button.

- **Who:** everyone who can open the page (superadmin, the brigade's VSOs and Brigade Admins). No new permission: anyone who can reach this page can already see the Brigade Link.
- **Inactive brigade:** still downloadable. The link shows the inactive message rather than breaking, and the same printout works again once the brigade is reactivated.
- **Title source:** the brigade's current saved name, so a rename in Details followed by a download uses the new name.
- **URL:** `<origin>/{slug}`, built from `window.location.origin` like the old appliance link.
- **Behaviour:** the button shows "Preparing…" while the QR library and jsPDF load (both lazily, like the Monthly Report PDF). A failure shows the error toast "Couldn't make the QR code". The file is `<Brigade name> QR code.pdf`.

## The PDF

A4 portrait, everything centred, black on white, no decoration:

1. **Title:** `<Brigade name> Appliance Checks`, using the name as stored (e.g. "Local Brigade Appliance Checks"), in Helvetica bold. It starts at about 32pt and shrinks to fit the printable width, down to about 22pt. Below that it wraps onto two lines at the smallest size. Macrons are flattened with the Monthly Report PDF's `pdfText` (built-in Helvetica can't draw them).
2. **QR code:** about 140mm square, drawn as vector squares, with error correction level Q (it survives about 25% damage, which suits an engine bay) and the version chosen automatically. Keep a blank margin of at least 4 squares around it.
3. **"Scan to start a Check"**, about 18pt.
4. **The Brigade Link URL**, about 11pt in grey, so it can be typed if a phone won't scan the code.

ASCII art for decoration was explored and left out for now.

### QR generation

`qrcode-generator` (no dependencies, ships its own types) gives the grid of squares, and jsPDF draws each dark square as a filled rectangle. Rejected: `qrcode` as a PNG placed into the PDF (heavier, and raster output needs a high resolution to print crisply); a Cloud Function (a network round trip and a deploy for something the browser does fine).

## Removing per-appliance QR links

- The Appliance admin page loses its "QR link" field and Copy button, along with their CSS.
- The deactivate confirmation becomes "`<callsign>` will drop off the Brigade Link. Deactivate it?"
- `cli/add-appliance.ts` prints `Brigade Link: <host>/{slug}` instead of the appliance URL, and the `--id` error says the id "becomes part of the appliance's URL".
- `CONTEXT.md`: the **Brigade Link** is "usually reached via the brigade's QR code, put up where Checks start".
- `/{slug}/{applianceId}` stays a valid route, so any QR codes already printed keep working.

## Testing

- **Unit (`tests/domain`):** title fitting is a pure function that takes the name, a function that measures text width at a font size, and the available width, and returns a size and lines:
  1. A short name stays on one line at the largest size.
  2. A mid-length name shrinks but stays on one line.
  3. A name too long even at the smallest size wraps onto two lines at that size.
- **E2E:** a superadmin opens `/e2etst/admin` and clicks Download PDF. The download is named `E2E Test Brigade QR code.pdf`, starts with `%PDF`, and contains `/e2etst` as text (jsPDF doesn't compress text by default).
- **Manual:** scan a generated PDF, both on screen and printed, with a phone.
- Not tested: that the QR code decodes. That's the library's job, and testing it would need a decoder dependency.

## Out of scope

Per-appliance QR codes; decorative art; link rotation (ADR 0001) beyond reprinting this sheet.
