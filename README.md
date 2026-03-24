# Mangawhai Brigade Appliance Checks

A mobile-optimised web app for completing weekly and monthly appliance checks, replacing a Google Sheets-based manual process. Built on Google Apps Script with a Vue 3 frontend — no external infrastructure required.

## How it works

The app reads check data directly from Google Sheets (one sheet per appliance) and presents it as a touch-friendly checklist. Checks are written back to the sheet in real time as the user taps Y/N buttons, selects dropdowns, or enters text values.

Each appliance has a QR code in the engine bay that opens the app pre-selected to that appliance's sheet. The bare URL without a `?sheet=` parameter shows an appliance picker instead.

## Repository structure

```
Code.gs          # Apps Script backend — sheet reads, writes, doGet
Index.html       # Vue 3 frontend — single page app
appsscript.json  # Apps Script manifest (access level, runtime config)
Makefile         # clasp push/deploy helpers
```

> **Note:** Sheet IDs are stored as Script Properties, not in source. See setup instructions below.

## Sheet format

The app expects each appliance sheet to follow this layout:

| Row | Content |
|-----|---------|
| 1–2 | Title / registration headers |
| 3   | Date headers — one per week column pair, merged across Y/N cols |
| 4+  | Section header rows (col B = "Quantity") and item rows |

Columns: A = item label, B = quantity/`FUEL`/`n/a`, C onwards = alternating Y/N column pairs per week.

Input type is detected from cell validation:
- **Checkbox validation** → Y/N toggle buttons
- **Dropdown (VALUE_IN_LIST) validation** → select input
- **No validation** → free text input

Monthly items are identified by a dark grey cell background (`#434343`) on their Y column.

## Setup

### Prerequisites

- [clasp](https://github.com/google/clasp) installed and authenticated (`clasp login`)
- A standalone Apps Script project created at [script.google.com](https://script.google.com)
- The project's Script ID added to `.clasp.json`

### 1. Push the code

```bash
make push
```

### 2. Configure appliance sheet IDs

Sheet IDs are kept out of source control and stored as a Script Property. In the Apps Script editor, open the **Script Properties** panel (**Project Settings → Script Properties**) and add one property:

| Key | Value |
|-----|-------|
| `APPLIANCES` | See format below |

The value should be a JSON object mapping URL-safe keys to appliance config:

```json
{
  "mangawhai801":  { "sheetId": "YOUR_SHEET_ID", "callsign": "Mangawhai 801" },
  "mangawhai8011": { "sheetId": "YOUR_SHEET_ID", "callsign": "Mangawhai 8011" },
  "mangawhai8029": { "sheetId": "YOUR_SHEET_ID", "callsign": "MANGAWHAI 8029" }
}
```

Alternatively, fill in the `setApplianceProperties()` function in `Code.gs` with the real sheet IDs, run it once from the editor, then remove it before committing.

The deploying Google account must have **edit access** to all three sheets.

### 3. Deploy

```bash
make deploy
```

The web app should be deployed with **Execute as: Me** and **Who has access: Anyone**. This is set in `appsscript.json` via:

```json
"webapp": {
  "executeAs": "USER_DEPLOYING",
  "access": "ANYONE_ANONYMOUS"
}
```

### 4. QR codes

Generate a QR code for each appliance using its URL:

```
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?sheet=mangawhai801
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?sheet=mangawhai8011
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?sheet=mangawhai8029
```

The bare URL without `?sheet=` shows the appliance picker and works as a fallback.

## Development

```bash
make push      # push latest code to Apps Script (no new deployment)
make deploy    # push and update the live deployment
make test-url  # print the HEAD (test) deployment URL
```

Changes to the live deployment require `make deploy`. The test deployment (HEAD) updates on every `make push` and can be used for testing without affecting the live QR codes.