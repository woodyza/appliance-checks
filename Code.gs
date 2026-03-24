// ============================================================
// Mangawhai Brigade Mobile Checklist - Apps Script Backend
// Deploy as standalone Web App: Execute as "Me", Access "Anyone"
//
// Appliance config (sheet IDs + callsigns) is stored in Script Properties,
// not in source. Run setApplianceProperties() once after first deploy to
// populate them, then keep that function out of source control.
//
// QR codes can optionally encode ?sheet=<key> to pre-select an appliance,
// but the app works without it — the user picks from the in-app list.
// ============================================================

// ── Sheet structure constants ────────────────────────────────
// Adjust these if the sheet layout changes.
const DATE_ROW       = 3;        // 1-based row containing date headers
const DATA_COL_START = 3;        // 1-based first data column (col C = 3)
const LABEL_COL      = 1;        // Col A: item descriptions
const QTY_COL        = 2;        // Col B: quantity / "Quantity" / "FUEL" etc

// Background colour used by the sheet to mark monthly-only cells.
const MONTHLY_BG = '#434343';

// ── Appliance config ─────────────────────────────────────────

/**
 * Load the APPLIANCES map from Script Properties.
 * Stored as JSON under the key 'APPLIANCES'. Throws clearly if
 * the property is missing or malformed.
 */
function getAppliances() {
  const raw = PropertiesService.getScriptProperties().getProperty('APPLIANCES');
  if (!raw) {
    throw new Error(
      'APPLIANCES script property not set. ' +
      'Run setApplianceProperties() from the script editor to configure.'
    );
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('APPLIANCES script property is not valid JSON: ' + e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Resolve the ?sheet= parameter to an appliance config entry.
 * Returns the config object, or throws a descriptive error if
 * the key is missing or unrecognised.
 */
function getAppliance(sheetParam) {
  const appliances = getAppliances();
  if (!sheetParam) {
    throw new Error(
      'No appliance specified. Valid options are: ' +
      Object.keys(appliances).join(', ')
    );
  }
  const key = sheetParam.toString().toLowerCase().trim();
  const appliance = appliances[key];
  if (!appliance) {
    throw new Error(
      'Unknown appliance "' + sheetParam + '". ' +
      'Valid options are: ' + Object.keys(appliances).join(', ')
    );
  }
  return appliance;
}

/**
 * ONE-TIME SETUP — run this once from the Apps Script editor after deploy,
 * then remove or exclude from source control.
 *
 * Project settings → Script Properties is the alternative UI for managing
 * these values if you prefer not to run this function.
 */
function setApplianceProperties() {
  const appliances = {
    'mangawhai801':  { sheetId: 'REPLACE_WITH_SHEET_ID', callsign: 'Mangawhai 801' },
    'mangawhai8011': { sheetId: 'REPLACE_WITH_SHEET_ID', callsign: 'Mangawhai 8011' },
    'mangawhai8029': { sheetId: 'REPLACE_WITH_SHEET_ID', callsign: 'MANGAWHAI 8029' },
  };
  PropertiesService.getScriptProperties().setProperty(
    'APPLIANCES', JSON.stringify(appliances)
  );
  Logger.log('APPLIANCES property set successfully.');
}

/**
 * Open the spreadsheet for the given appliance config and return
 * the named sheet tab. Throws clearly if the sheet cannot be opened.
 */
function getSheet(appliance) {
  let ss;
  try {
    ss = SpreadsheetApp.openById(appliance.sheetId);
  } catch (e) {
    throw new Error(
      'Could not open spreadsheet for ' + appliance.callsign +
      ' (id: ' + appliance.sheetId + '). ' +
      'Check the sheet ID in APPLIANCES config and that the deploying account has access.'
    );
  }
  const sheet = ss.getSheets()[0];
  return { ss, sheet };
}

// ── Entry points ─────────────────────────────────────────────

function doGet(e) {
  const param = (e && e.parameter && e.parameter.sheet) || '';

  // Build the safe appliance list (keys + callsigns only, no sheet IDs)
  // and bake it into the template along with the optional initial selection.
  // The client uses these to render the picker and auto-select if appropriate.
  let applianceList = [];
  try {
    applianceList = Object.entries(getAppliances()).map(([key, app]) => ({
      key,
      callsign: app.callsign
    }));
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font-family:sans-serif;padding:2rem;background:#0f1117;color:#e8eaf0">' +
      '<h2 style="color:#ef4444">⚠ Configuration Error</h2>' +
      '<p>' + err.message + '</p>' +
      '</body>'
    );
  }

  // Validate the initial sheet param if provided — fail clearly rather than
  // letting the client boot with a key it can never resolve.
  const validKeys = applianceList.map(a => a.key);
  const initialSheet = validKeys.includes(param.toLowerCase().trim()) ? param.toLowerCase().trim() : '';

  const tmpl = HtmlService.createTemplateFromFile('Index');
  tmpl.applianceList = JSON.stringify(applianceList);
  tmpl.initialSheet  = initialSheet;
  return tmpl.evaluate()
    .setTitle('Appliance Checks')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Main data loader ─────────────────────────────────────────

/**
 * Returns the full sheet structure:
 * {
 *   weeks:    [ { label, isoDate, yCol, nCol } ],   // 1-based cols
 *   sections: [ { title, items: [ Item ] } ]
 * }
 *
 * Item: { row, label, qty, inputType, dropdownOptions, weekValues }
 *
 *   inputType is determined solely from cell validation metadata — never
 *   from cell values — so it is cold-start safe on a fresh month:
 *
 *     'yn'       — Y-column has CHECKBOX validation
 *     'dropdown' — Y-column has VALUE_IN_LIST validation
 *     'text'     — no validation (free text: dates, odometer, etc.)
 *
 *   weekValues (yn):       [ { yCol, nCol, yChecked, nChecked } ]
 *   weekValues (dropdown): [ { yCol, nCol, value } ]
 *   weekValues (text):     [ { yCol, nCol, value, prevValue } ]
 *                            prevValue = nearest earlier week with a value,
 *                            shown in the UI with a "copy" affordance.
 *   scope: 'weekly' | 'monthly'
 *     monthly items are only active on the last week of the month;
 *     detected from cell background colour (MONTHLY_BG constant).
 */
function getSheetData(sheetParam) {
  const appliance = getAppliance(sheetParam);
  const { ss, sheet } = getSheet(appliance);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const tz      = ss.getSpreadsheetTimeZone();
  // Include callsign so the UI can display the correct header
  const callsign = appliance.callsign;

  // Single bulk reads — one API call each, critical for 200-row performance
  const allValues      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const allValidations = sheet.getRange(1, 1, lastRow, lastCol).getDataValidations();
  const allBackgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();

  // ── Step 1: Discover Y/N column pairs from section header rows ──
  //
  // Section header rows have col B = "Quantity" and carry Y/N text labels
  // in the data columns. We use the FIRST such row as the authoritative
  // column map. This is robust to merged date cells above and to typos
  // like "N)" — we strip non-alpha chars before comparing.

  let weeks = [];

  for (let r = 0; r < lastRow && weeks.length === 0; r++) {
    if (String(allValues[r][QTY_COL - 1]).trim().toLowerCase() !== 'quantity') continue;

    for (let c = DATA_COL_START - 1; c < lastCol - 1; c++) {
      const v    = String(allValues[r][c]).trim().toUpperCase().replace(/[^A-Z]/g, '');
      const next = String(allValues[r][c + 1]).trim().toUpperCase().replace(/[^A-Z]/g, '');
      if (v !== 'Y' || next !== 'N') continue;

      // Scan left along DATE_ROW for the nearest non-empty date label
      let dateLabel = `Col ${c + 1}`;
      let isoDate   = '';
      for (let lb = c; lb >= DATA_COL_START - 1; lb--) {
        const cell = allValues[DATE_ROW - 1][lb];
        if (cell === '' || cell === null || cell === undefined) continue;
        if (cell instanceof Date) {
          isoDate   = Utilities.formatDate(cell, tz, 'yyyy-MM-dd');
          dateLabel = Utilities.formatDate(cell, tz, 'dd/MM/yy');
        } else {
          dateLabel = String(cell).trim();
          const parsed = new Date(cell);
          isoDate = isNaN(parsed) ? dateLabel : Utilities.formatDate(parsed, tz, 'yyyy-MM-dd');
        }
        break;
      }

      weeks.push({ label: dateLabel, isoDate, yCol: c + 1, nCol: c + 2 }); // 1-based
      c++; // skip the N column
    }
  }

  // ── Step 2: Walk item rows, build sections ───────────────────

  const sections = [];
  let currentSection = null;

  for (let r = DATE_ROW; r < lastRow; r++) {
    const label = String(allValues[r][LABEL_COL - 1]).trim();
    const qty   = String(allValues[r][QTY_COL - 1]).trim();
    if (!label) continue;

    // Section header
    if (qty.toLowerCase() === 'quantity') {
      currentSection = { title: label, items: [] };
      sections.push(currentSection);
      continue;
    }
    if (!currentSection || weeks.length === 0) continue;

    // ── Input type: validation metadata only, never cell values ──
    //
    // Fall-through priority:
    //   1. CHECKBOX validation  → 'yn'
    //   2. VALUE_IN_LIST        → 'dropdown'
    //   3. anything else / none → 'text'

    let inputType       = 'text';   // safe default
    let dropdownOptions = [];

    const firstYValidation = allValidations[r][weeks[0].yCol - 1];
    if (firstYValidation) {
      try {
        const cType = firstYValidation.getCriteriaType();
        const cVals = firstYValidation.getCriteriaValues();
        if (cType === SpreadsheetApp.DataValidationCriteria.CHECKBOX) {
          inputType = 'yn';
        } else if (cType === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
          inputType       = 'dropdown';
          dropdownOptions = (cVals && cVals[0]) ? cVals[0] : [];
        }
        // Any other validation type falls through to 'text'
      } catch (_) { /* getCriteriaType can throw — treat as text */ }
    }
    // No validation at all → already 'text'

    // ── Scope: weekly vs monthly ─────────────────────────────
    //
    // Only yn (checkbox) rows can be monthly — the grey background is only
    // meaningful on checkbox cells. Dropdowns and text fields are always
    // weekly regardless of cell background (their merged cells are grey
    // as a layout choice, not a schedule marker).

    let scope = 'weekly';
    if (inputType === 'yn') {
      const firstYBg = String(allBackgrounds[r][weeks[0].yCol - 1]).toLowerCase();
      if (firstYBg === MONTHLY_BG.toLowerCase()) scope = 'monthly';
    }

    // ── Build per-week values ─────────────────────────────────

    const weekValues = weeks.map(week => {
      const raw = allValues[r][week.yCol - 1];

      if (inputType === 'yn') {
        return {
          yCol:     week.yCol,
          nCol:     week.nCol,
          yChecked: raw === true,
          nChecked: allValues[r][week.nCol - 1] === true
        };
      }

      // dropdown / text: normalise the value to a string.
      //
      // Sheets coerces fraction strings like "1/4" and "1/2" into Date
      // objects when read back via getValues(). For dropdown cells we
      // match the raw value back against the known options list first —
      // if any option parses to the same Date, use that option string
      // instead of formatting the date. This recovers "1/4", "1/2" etc.
      let value = '';
      if (raw instanceof Date) {
        if (inputType === 'dropdown' && dropdownOptions.length > 0) {
          // Try to find a dropdown option that Sheets would interpret
          // as the same date value.
          const match = dropdownOptions.find(opt => {
            const parsed = new Date(opt);
            return !isNaN(parsed) && parsed.getTime() === raw.getTime();
          });
          value = match !== undefined ? match : Utilities.formatDate(raw, tz, 'dd/MM/yyyy');
        } else {
          value = Utilities.formatDate(raw, tz, 'dd/MM/yyyy');
        }
      } else if (raw !== null && raw !== undefined && raw !== false) {
        value = String(raw).trim();
      }

      return { yCol: week.yCol, nCol: week.nCol, value };
    });

    // For text rows: find the nearest previous week that has a value
    // so the UI can offer a "copy from last week" affordance.
    let prevValue = '';
    if (inputType === 'text') {
      // Walk backwards through weekValues (skip the last/current week)
      for (let wi = weekValues.length - 2; wi >= 0; wi--) {
        if (weekValues[wi].value !== '') {
          prevValue = weekValues[wi].value;
          break;
        }
      }
    }

    currentSection.items.push({
      row: r + 1,   // 1-based
      label,
      qty,
      inputType,
      dropdownOptions,
      weekValues,
      prevValue,    // '' if none; only meaningful for inputType === 'text'
      scope         // 'weekly' | 'monthly'
    });
  }

  return { weeks, sections, callsign };
}

/**
 * Write a single checkbox value to the sheet.
 * col is 1-based. value is true/false.
 */
function writeCellBool(row, col, value, sheetParam) {
  const { sheet } = getSheet(getAppliance(sheetParam));
  sheet.getRange(row, col).setValue(value);
}

/**
 * Write a text/dropdown value to the sheet.
 * Sets the cell format to Plain Text (@STRING@) before writing so that
 * values like "1/4" and "1/2" are never coerced into date serial numbers
 * by Sheets. This also heals any previously coerced cells on next write.
 */
function writeCellText(row, col, value, sheetParam) {
  const { sheet } = getSheet(getAppliance(sheetParam));
  const cell = sheet.getRange(row, col);
  cell.setNumberFormat('@STRING@');
  cell.setValue(value);
}

/**
 * Handle Y/N toggle logic:
 * - Tapping Y: set Y=true, N=false
 * - Tapping N: set Y=false, N=true
 * - Tapping the active button again: clear both (back to unchecked)
 */
function toggleYN(row, yCol, nCol, button, currentY, currentN, sheetParam) {
  const { sheet } = getSheet(getAppliance(sheetParam));
  let newY = false, newN = false;

  if (button === 'Y') {
    newY = !currentY; // toggle; if was Y, clear; if wasn't, set Y
    newN = false;
  } else if (button === 'N') {
    newN = !currentN;
    newY = false;
  }

  sheet.getRange(row, yCol).setValue(newY);
  sheet.getRange(row, nCol).setValue(newN);

  return { yChecked: newY, nChecked: newN };
}