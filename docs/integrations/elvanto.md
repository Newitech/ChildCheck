# Elvanto connector

The Elvanto connector lives at **`/admin/integrations/elvanto`** and lets an
admin:

1. **Import** people + families from an Elvanto CSV (or pasted JSON) into
   ChildCheck — with a mandatory dry-run preview and idempotent matching
   (re-importing the same file updates rather than duplicates).
2. **Export** every active ChildCheck person + family as an Elvanto-format
   CSV — for pushing back to Elvanto or as a backup.
3. **Quick-add** a single Elvanto record (form-based) for one-off imports.

It does NOT contact Elvanto directly — you export the CSV from Elvanto's
admin console and upload it here.

> Requires **Admin** or **PeopleManager** role (`manage_people` permission).
> The export endpoint additionally accepts **Security** (`view_people`).

---

## 1. Exporting from Elvanto

In your Elvanto admin console:

1. **People → People → Export** (the menu label varies slightly between
   Elvanto versions).
2. Choose the **People** report.
3. Select the columns you want to export (see the canonical set below).
4. Choose **CSV** as the format.
5. Click **Export** and save the file.

### Canonical Elvanto CSV columns

The connector accepts (case- and separator-insensitive):

```
First Name, Last Name, Email, Mobile, Birthday, Gender,
Family ID, Family Name, Family Role, School Grade,
Medical Info, Allergies, Marital Status,
Address, Suburb, State, Postcode, Country,
Photo URL, Created Date
```

**Common variants are auto-recognised.** For example, all of these map to
the same ChildCheck field (`Person.firstName`):

- `First Name` (canonical)
- `Firstname`
- `First_Name`
- `first_name`
- `GivenName`
- `Given Name`

Unknown columns are silently ignored (and surfaced as "unmatched source
columns" in the dry-run preview, so you can verify nothing important was
dropped).

### Minimum viable CSV

If you only want the basics, this is the minimum Elvanto CSV that will
import cleanly (3 people — 2 adults + 1 child — in the same family):

```csv
First Name,Last Name,Email,Mobile,Birthday,Gender,Family ID,Family Name,Family Role,School Grade,Medical Info,Allergies
John,Smith,john@example.com,+1 555 0100,1985-04-12,Male,FAM-1,Smith,Head of Household,,
Mary,Smith,mary@example.com,+1 555 0101,1987-09-22,Female,FAM-1,Smith,Spouse,,
Tom,Smith,,,2017-03-12,Male,FAM-1,Smith,Child,Grade 2,,Peanuts
```

---

## 2. Field mapping (Elvanto → ChildCheck)

| Elvanto field                | ChildCheck field                     | Notes |
|------------------------------|--------------------------------------|-------|
| First Name                   | `Person.firstName`                   | Required. |
| Last Name                    | `Person.lastName`                    | Required. |
| Email                        | `Person.email`                       | Used as the adult match key for idempotency. |
| Mobile                       | `Person.phone`                       | |
| Birthday                     | `Person.dateOfBirth`                 | ISO `YYYY-MM-DD`, `DD/MM/YYYY`, or `MM/DD/YYYY` accepted. |
| Gender                       | `Person.gender`                      | `Male` / `Female` / `Other` (case-insensitive; `m` / `f` short forms accepted). |
| Family ID                    | *(grouping key)*                     | Rows sharing this ID are placed in the same Family. |
| Family Name                  | `Family.familyName`                  | Used when creating a new Family row. If blank, derived from the head of household's surname. |
| Family Role                  | `FamilyMember.role`                  | See role-mapping table below. |
| School Grade                 | `Person.schoolGrade`                 | |
| Medical Info                 | `Person.medicalNotes` / `Person.allergies` | Values containing the word "allerg" are appended to `Person.allergies`; the rest go to `Person.medicalNotes`. |
| Allergies                    | `Person.allergies`                   | |
| Marital Status               | *(not stored)*                       | Read but not persisted. `'Visitor'` value flags the person as a visitor. |
| Address / Suburb / State / Postcode / Country | *(not stored)* | **Child-safety data minimisation.** Accepted on import, ignored. The export-back-to-Elvanto CSV emits empty address fields. |
| Photo URL                    | *(not stored)*                       | Photo storage in ChildCheck is via the photo upload UI (encrypted at rest). |
| Created Date                 | *(not stored)*                       | ChildCheck records its own `createdAt` on insert. |

### Family Role mapping

| Elvanto Family Role                       | ChildCheck FamilyMember.role |
|-------------------------------------------|------------------------------|
| `Head of Household`, `Head`, `Spouse`, `Adult`, `Parent`, `Primary Carer` | `PrimaryCarer` |
| `Child`, `Dependant`, `Dependent`, `Minor` | `Child` |
| `Authorised Guardian`, `Guardian`         | `AuthorisedGuardian` |
| `Emergency Contact`                       | `EmergencyContact` |
| `Other`, `Visitor`, `Guest`, `""` (blank) | `EmergencyContact` (default) |

Any role string not recognised is mapped to `EmergencyContact` (the
least-permissioned ChildCheck role) — admins can re-assign via the
family-detail UI after import.

---

## 3. The import process

### Dry-run (mandatory preview)

Before any DB writes, the import API returns a **preview** of what WOULD
happen:

- `totalPeople` — total records parsed.
- `newPeople` — how many would be CREATED.
- `matchedPeople` — how many would be matched to an existing Person.
- `families` — grouped by Elvanto Family ID, with each member's
  `firstName`, `lastName`, `role`, `personType`, and
  `action` (`"create"` or `"match"`).
- `errors` — per-row validation errors (e.g. "First Name is required").
- `parseWarnings` — non-fatal parse issues (e.g. row-column-count
  mismatch).
- `unmatchedColumns` — Elvanto columns that didn't match any known field
  (silently ignored).

The "Import for real" button stays **disabled** until the dry-run returns
`0 errors` and `totalPeople > 0`.

### Real import

When `dryRun=false`:

1. **Validate** every record. HARD STOP if any row has an error — nothing
   is written.
2. **Match-or-create** each Person:
   - **Adults** (personType `Adult` or family role maps to `PrimaryCarer`
     / `AuthorisedGuardian` / `EmergencyContact`): matched by `email` if
     present, else by `firstName + lastName` (case-insensitive — SQLite's
     default).
   - **Children** (personType `Child` or family role maps to `Child`):
     matched by `firstName + lastName + dateOfBirth` (if DOB present),
     else by `firstName + lastName`.
   - **On match**: UPDATE non-empty fields only — existing data is NEVER
     overwritten with blanks. `firstName` / `lastName` are not overwritten
     (they're the match key).
   - **On no match**: CREATE a new Person row.
3. **Group** rows by Elvanto Family ID. For each group:
   - If any member matched an existing Person who is already in a Family,
     reuse that Family.
   - Otherwise, CREATE a new Family row (using the Elvanto Family Name
     or the head of household's surname).
   - Attach each member via `FamilyMember.upsert` (idempotent —
     `@@unique([familyId, personId])` prevents duplicate memberships).
4. **Audit log**: `elvanto.import` action is written with the counts.
5. **Atomic**: the whole import runs in a single Prisma `$transaction` —
   any error rolls the entire batch back. Nothing is half-imported.

### Idempotency

Re-importing the same file produces:

```json
{ "imported": 0, "updated": 3, "familiesCreated": 0, "familiesMatched": 1 }
```

— no duplicates. Each Person row was matched (by email for adults, by
name+DOB for children) and updated with any new fields that were blank in
ChildCheck. The Family was reused via the existing membership.

---

## 4. Quick add a single record

The **Quick add** tab provides a form with Elvanto field labels (First
Name, Last Name, Email, Mobile, Birthday, Gender, Family Name, Family
Role, etc.). It submits to the same individual import API (`/api/admin/
integrations/elvanto/import-one`) that the bulk import uses internally —
the same idempotency rules apply.

Useful for:

- Adding a new family that joins mid-term.
- Re-trying a single record that failed in a bulk import.
- Quick entry without composing a CSV.

---

## 5. Export to Elvanto

The **Export** tab streams an Elvanto-format CSV of every active ChildCheck
person. The columns are in the canonical Elvanto order:

```
First Name, Last Name, Email, Mobile, Birthday, Gender,
Family ID, Family Name, Family Role, School Grade,
Medical Info, Allergies
```

- **Family ID**: the ChildCheck `Family.id` (a cuid). Elvanto will treat
  these as new families on re-import — this is the documented behaviour
  for a one-way push.
- **Family Role**: derived from `FamilyMember.role`
  (`PrimaryCarer` → `"Head of Household"`, `Child` → `"Child"`,
  `AuthorisedGuardian` / `EmergencyContact` → `"Other"`).
- **Birthday**: formatted as `YYYY-MM-DD` (UTC, for stable cross-tz output).
- A person with multiple family memberships appears on multiple rows
  (one per family) — mirrors how Elvanto would export a shared-custody
  child.

The export endpoint is `GET /api/admin/integrations/elvanto/export`. It
returns `Content-Type: text/csv` with a
`Content-Disposition: attachment; filename=childcheck-to-elvanto-<date>.csv`
header. An `elvanto.export` audit-log entry is written with the count.

---

## 6. API reference

### `POST /api/admin/integrations/elvanto/import?dryRun=(true|false)`

**Body**: `multipart/form-data` with either `file` (CSV) or `json` (JSON
text — single record or array). Or `application/json` for the JSON-only
path.

**dryRun=true (default)** → 200 with a preview JSON:

```json
{
  "dryRun": true,
  "totalPeople": 3,
  "newPeople": 3,
  "matchedPeople": 0,
  "families": [
    {
      "familyId": "FAM-1",
      "familyName": "Smith",
      "members": [
        { "row": 1, "firstName": "John", "lastName": "Smith",
          "email": "john@example.com", "role": "PrimaryCarer",
          "personType": "Adult", "action": "create" },
        { "row": 2, "firstName": "Mary", "lastName": "Smith",
          "email": "mary@example.com", "role": "PrimaryCarer",
          "personType": "Adult", "action": "create" },
        { "row": 3, "firstName": "Tom", "lastName": "Smith",
          "email": null, "role": "Child",
          "personType": "Child", "action": "create" }
      ]
    }
  ],
  "errors": [],
  "parseWarnings": [],
  "unmatchedColumns": []
}
```

**dryRun=false** → 200 with the import result:

```json
{
  "dryRun": false,
  "totalPeople": 3,
  "imported": 3,
  "updated": 0,
  "familiesCreated": 1,
  "familiesMatched": 0,
  "errors": [],
  "parseWarnings": [],
  "unmatchedColumns": []
}
```

### `POST /api/admin/integrations/elvanto/import-one?dryRun=(true|false)`

**Body**: `application/json` — a single Elvanto record (object with any of
the recognised field names).

Returns `{ dryRun, personId, action, familyId, familyCreated, familyRole }`.

### `GET /api/admin/integrations/elvanto/export`

Returns the Elvanto-format CSV as a downloadable attachment.

---

## 7. Troubleshooting

### "Missing required column(s): ..."
The Elvanto CSV header row is missing a required column. The Elvanto
connector requires at least `First Name` and `Last Name` — everything else
is optional. Re-export from Elvanto with these columns included.

### "First Name is required."
A row has a blank `First Name`. Either fill it in or remove the row from
the CSV.

### "Import failed — entire batch rolled back."
The transaction threw — usually a Prisma constraint violation. The error
message includes the underlying detail. Fix the offending row and re-run
the dry-run.

### Re-import produces duplicates
This shouldn't happen — the connector is idempotent. If it does:

- Check that the email field on the Elvanto CSV exactly matches the email
  on the existing Person (case-insensitive, but trailing whitespace is
  trimmed).
- For children, ensure the date-of-birth on the CSV exactly matches the
  DOB on the existing Person. If the DOB is missing on either side, the
  match falls back to `firstName + lastName`.
- If two existing Persons in ChildCheck already share the same
  `firstName + lastName`, the connector picks the first one found —
  consider merging them first via the admin UI.

### The export CSV has empty address fields
This is by design — ChildCheck doesn't store street addresses (child-safety
data minimisation). The Elvanto CSV format expects the columns to be
present, so they're emitted as empty strings.

### The Family ID on the export doesn't match Elvanto's
ChildCheck uses its own `Family.id` (a cuid) as the Family ID column on
the export. Elvanto will treat these as new families on re-import. This is
the documented behaviour for a one-way push — if you need true two-way
sync, contact your ChildCheck administrator about a custom integration.

### Unmatched columns warning in the dry-run preview
The connector found columns in the CSV that it didn't recognise (e.g. a
custom field "Department" or a typo like "Frist Name"). The columns are
silently ignored — the import will still proceed. Check the
`unmatchedColumns` list in the dry-run response to verify nothing
important was dropped.
