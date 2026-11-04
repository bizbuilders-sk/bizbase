# Field decisions — closed 4 November 2026

The field review that ran from 21 October to 4 November is **closed**. Its decisions now live in code:

- `src/table-field-policy.ts`: which fields each table offers as Column / Filter / Group by
- `src/workspace-model.ts`: field labels and default groupings

**To change a field from now on, edit those files directly** (a one-line change plus its test). Don't generate another review to decide it.

## How it was closed

- Your edited sheet (`BizBase fields and values review.xlsx`, saved 4 Nov) won wherever you changed a cell.
- The 43 open recommendations were accepted as written.
- Financial amounts: Project *Revenue plan* and *Vendor budget* are Project card only. *Budget* and *Actual* stay in the Vendor costs list, because that list is their detail view.
- Removing a field from a table never deletes data. The value stays on the record card and in imported history.

## Changes you might notice

- **Contacts:** Company and Job title are no longer Group-by options. The default grouping is now Company lead status. Email, Phone and Last name can be filtered. The Company ID column was added. Company size and Revenue range columns were removed (Revenue range is still a filter and grouping).
- **Companies:** Company ID column added. Website, Invoice email and Company size are now card only. *Form received on* removed.
- **Deals:** Contact filter and Deal value filter removed (your sheet). Company stays as a filter and grouping even though the sheet removed it, because the **By company** button needs it (found while checking the app). Lost reason can be grouped. Deal labels retired. *Forecast · EUR* is renamed *Deal value · EUR*.
- **Projects:** Revenue plan, Vendor budget, Deal, Data quality and the Company lead status / lifecycle columns removed. Contact phone added. Contact and Deal can be filtered. Contract value is no longer a filter.
- **Webform submissions tab** (called Event history until 4 Nov 2026): Registrant name, email, phone, reported company, attendance, sales interest and review status now come from the linked Contact. Detailed answers (offering, competitors, brand, takeaway, website, source detail) are columns.
- **Retired everywhere:** First email sent, Interest, Full report requested, Event period, Vendor expected/invoice dates, Service default group.
- **Renamed:** Company registration no. → *Company ID*; Marketing follow-up → *Sales follow-up*; Discovery channel → *How they heard about us*; Reported source → *Source detail*; Registered on → *Form received on*.

## Three accepted recommendations that reverse an earlier decision of yours (22 Oct)

1. Company ID is a Companies column (was card only).
2. Invoice email is card only (was one combined column).
3. Company size is card only (was in the Columns chooser under TBD).

To undo any of these, add or remove the key in `TABLE_CONTROLS.accounts`.

## Where the code differs from the sheet

- **Service catalog** keeps *Active* as its filter and grouping. The sheet retired it and asked to group by Service name, but the app never groups by names, and the catalog needs at least one category.
- **Vendor:** the existing *Vendor* field (`vendor_name`) is the single merged field.
- **Enquiries** weren't in the review. Only the fields retired everywhere were removed there.
- Items the review listed as "Source / internal detail" (e.g. *First received*, *Added to BizBase*) are unchanged.

## Field order (4 November 2026)

Decided from common CRM practice (Pipedrive/HubSpot pattern): the most important field first, at most about 8 default columns, and record cards in the order key fields → relationships → details, with context and imported/system fields collapsed.

**Default table columns**, in order. Everything else stays in the Columns picker.

| Table | Default columns |
|---|---|
| Contacts | First name, Last name, Company, Job title, Email, Phone, Company lead status, Sales follow-up |
| Companies | Company name, Lead status, Lifecycle, Industry, Business roles, First received, Sales follow-up |
| Deals | Deal, Company, Contact, Stage, Deal value, Expected close, Next activity, Sales owner |
| Projects | Project, Company, Phase, Group, Contract, Start, End, Project owner |

Everyone's saved column layout was reset to these defaults once. Filters, sorting and grouping were kept.

**Record cards**, section by section (collapsed sections in *italics*):

- **Deal:** Deal (stage, value, probability, expected close, next activity, owner; lost reason only for lost deals) → Company & contact → Scope → *Company details* → *Imported & system*
- **Project:** Project (phase, group, owner, contract, dates) → Client → Links → *Company details* → *Imported & system*
- **Company:** Company → Facts → *Names* → *Record info*
- **Contact:** one section (name, job title, company, email, phone)

**Card tabs:** the Enquiries and Imported fields tabs are removed from every card. Nearly all enquiries duplicate a webform submission, and the original ClickUp/Pipedrive snapshots stay in the database. Typical tabs are now Company: Details, Contacts, Deals, Projects, Webform submissions, Notes; Contact: Details, Company, Deals, Projects, Webform submissions, Notes. The Webform submissions tab (formerly Event history) holds every form submission: event/webinar registrations with their answers, plus standalone contact-form messages listed below them.

**Lists inside a card** (e.g. a Contact's Deals) always open unfiltered, so the card's counts and its lists agree. The main Deals screen still opens on Open deals.

**To change any of this,** edit `TABLE_CONTROLS` (`columns` order and `visible`) or `CARD_LAYOUT` in `src/table-field-policy.ts`. To push a new default column order to everyone's saved layouts, bump `LAYOUT_VERSION` in `src/workspace-model.ts`.

## Not done: features, not field settings

These came up in the review but are new features. Each should be built on its own when it becomes a priority, not reopened as a review:

1. **Responses view.** The sheet moves form answers off Contacts/Companies into a Responses view. Until one exists, Sales follow-up, audit/consultation requested and How they heard about us stay on Contacts/Companies.
2. **Form definitions.** A Form field replacing *Form type*, with form-specific questions ("+ Add field").
3. **One contextual Notes feature** across Contact, Company, Deal, Project and Responses.
4. **Company name rule.** Confirmed legal name with suffix, otherwise the current name, then the trading name.

The earlier review files (`docs/*field*review*`, `docs/field-decisions-review-*`, `docs/guided-field-review-*`, the workbooks) are historical records. Don't regenerate them.
