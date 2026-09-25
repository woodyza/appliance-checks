# Appliance Checks

A brigade's routine checks that each appliance's equipment is present and serviceable, recorded on a phone at the appliance rather than on paper or a spreadsheet.

## Organisation

**Brigade**:
A volunteer fire brigade that owns one or more appliances and runs Checks on them.

**Brigade Link**:
The unguessable short URL that opens the app for one brigade, usually reached via an appliance's QR code. Through it, the app looks dedicated to that brigade alone.
_Avoid_: Brigade URL, brigade key

**Brigade Admin**:
A person who administers exactly one brigade, e.g. its Check Sheets and Monthly Reports.

**VSO**:
Volunteer Support Officer: a member of a regional team who administers their assigned brigades with the same powers as a Brigade Admin. The VSO team covers the region together.

**Report Email**:
The address a brigade's reports go to. It can be a shared VSO team address and defaults to the brigade's assigned VSO when it isn't set.

## Appliances

**Appliance**:
A brigade response vehicle whose equipment and condition get checked.
_Avoid_: Truck, vehicle

**Callsign**:
The radio name of an appliance (e.g. "Mangawhai 8011"), and the name people use for it.
_Avoid_: Name, ID

## Checks

**Check Sheet**:
The definition of the Sections and Items an appliance is checked against.
_Avoid_: Template, checklist

**Section**:
A named group of Items on a Check Sheet, e.g. a locker, an area of the cab, or a topic such as "Road user details".
_Avoid_: Locker, compartment, category

**Item**:
A single row on a Check Sheet, e.g. "Thermal Imaging Camera × 1", answered with Y / N, a choice, or a written value.
_Avoid_: Check (for a single row), line

**Weekly Item** / **Monthly Item**:
An Item that is due on every Check, or an Item that is only due on the last Check of the month.

**Check Day**:
The weekday a brigade runs its Checks, usually four or five times a month. A change applies only to Checks created afterwards.

**Check**:
One pass through every Item due on an appliance for a scheduled Check Day, identified by that scheduled date. It's due on that date, but is acceptable any time before the next Check is due, and still belongs to its scheduled date and month when it's done late. Every written value is entered afresh each time, even if it rarely changes (e.g. rego expiry).
_Avoid_: Check run, inspection

**Complete**:
A Check where every due Item is answered; an N counts as answered. Anything less is described by the percentage of due Items answered, and a Check nobody has started counts as 0%.
_Avoid_: Done, submitted

**Frozen**:
A Check that is Complete or whose window has closed. It no longer picks up changes to its Check Sheet unless someone opts it in, though its answers stay editable. A Check that isn't Frozen always reflects the latest Check Sheet.

**Y / N**:
The answer to a yes/no Item. Y means present and serviceable; N means missing, or faulty and needing removal from service.
_Avoid_: Pass/fail, OK/not OK

**Defect**:
A problem found during a Check. It gets recorded in the Defects Book, not in this system.
_Avoid_: Fault

**Defects Book**:
The brigade's record of Defects, kept outside this system.

**Monthly Report**:
The record of one appliance's Checks for a calendar month.
_Avoid_: Check sheet (for the filled-in month), monthly PDF
