---
name: lead-research
description: Research a lead's property and build its dossier — the county's property (assessor), permit, building and inspection records and any other public source — download the photos and documents, pencil in the JobTread customer, address and job fields, and write a one-paragraph property summary shaped by what the customer asked for. Runs on its own on Opus from the office Mac mini or the owner's MacBook (scripts/lead-research/) when the office taps Research on a lead. Use when the owner types /lead-research, or asks to "research this lead" or "run the property research".
model: opus
---

# Research a lead's property

The office tapped **Research** on a lead. Build the property dossier. Everything
you submit is **penciled in**: a person checks it on `/leads/research/<id>`
before any of it reaches JobTread. So be complete, and be honest about what you
could not confirm.

Research **the property**, not the people. Do not look up the customer's
social media, employment or finances. Owner names on public property records
are fine to record.

Every call goes through one helper. It holds the token:

```
node scripts/lead-research/agent.mjs <command> …
```

(If `node` is not found, prefix: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null;`)

## Step 1 — take the run

```
node scripts/lead-research/agent.mjs begin
```

"Nothing to research." means another Mac took it, or nothing is waiting. Stop.

Otherwise it prints the briefing: the lead, the address, the inquiry, what the
office asked you to look into, the JobTread fields you may fill (with what
each holds now), and where the files go. `.lead-research/run.json` holds the
same as JSON. Read the inquiry carefully. It decides what matters:

| They asked about | Dig hardest into |
|---|---|
| New build, land | lot size and shape, zoning, setbacks, critical areas, shoreline, slopes, septic suitability (perc / soil logs), water source and well logs, access and easements, power, short plat or survey |
| Remodel, addition | the existing structures (year, size, beds, baths, construction), every permit and inspection on the parcel, unpermitted work signs, septic design capacity versus bedrooms, shoreline or critical-area limits on expansion |
| Any | flood zone, geologic hazards, ownership and last sale, assessed value, taxes, past listings and their photos, utility providers, fire district |

Their budget, timing and design status go into the summary's last sentence and
the "Fit with the inquiry" facts: does the property make what they asked for
easy, hard or doubtful?

If there is no usable address, try the inquiry text (a parcel number, a road, an
island). If you still cannot place the property, run
`node scripts/lead-research/agent.mjs fail "No address to research. Add one to the lead."` and stop.

## Step 2 — the assessor

For a San Juan County, WA address (Lopez, Orcas, San Juan, Shaw and the outer
islands), start with the county assessor:

```
node scripts/lead-research/agent.mjs pacs <street number> <street name>
node scripts/lead-research/agent.mjs pacs --prop <prop_id>
```

It saves the search results and each parcel's detail page to
`.lead-research/pages/`, downloads the parcel photos to `.lead-research/files/`,
and lists the documents the page links. Read the detail pages with Read. Several
matches: pick the one whose situs address matches, and say how sure you are.
The detail page has the parcel number, owner, legal description, land size,
each improvement (year built, area, beds, baths, construction details), values
and sales.

For another county, find its assessor's parcel search with WebSearch and use
`fetch`.

## Step 3 — every other source

Use WebSearch to find each source, WebFetch to read a page, and `fetch` to save
a page or download a file:

```
node scripts/lead-research/agent.mjs fetch <url> [file name]
```

`fetch` keeps cookies for the run. An HTML answer lands in
`.lead-research/pages/` (read it with Read); a PDF or image in
`.lead-research/files/`. Read the PDFs you download; they are often the best
source.

Work through these. Search by parcel number as well as by address.

1. **Permits, building and inspections** — the county's permit search
   (San Juan County Community Development), every permit on the parcel with its
   number, type, status, dates, description and inspections. Download the
   permit documents and site plans that are public.
2. **Recorded documents** — the county auditor's recorded documents: surveys,
   short plats, easements, boundary line adjustments, covenants.
3. **Septic and water** — the county health department's septic (OSS) records:
   design, bedroom capacity, install and inspection dates. Washington
   Department of Ecology well reports. Water system or association.
4. **Land and hazards** — zoning and land-use designation, shoreline
   designation, critical areas (wetlands, fish and wildlife habitat, geologic
   hazards), FEMA flood zone (download the FIRMette PDF if you can), WA DNR
   geologic hazard and landslide maps.
5. **Utilities and access** — power (OPALCO in San Juan County), internet,
   fire district, road access, private road maintenance agreements.
6. **Listings and photos** — past and current listings (Zillow, Redfin,
   Windermere, other brokers). Record the sale history and download the listing
   photos and floor plans.
7. **Anything else** that bears on what they asked for: a town's own permits
   (Town of Friday Harbor), historic designations, news, a neighbouring
   project.

A portal that needs JavaScript or a login, or that refuses you: record it in
`sources` with `"reached": false` and the URL, so a person can check by hand.
Do not guess what it would have said.

Stay inside the limits the briefing printed. Keep the files that tell someone
about the property: the assessor photos, listing photos, floor plans, site
plans, permits, septic designs, well logs, surveys, flood maps. Leave out
duplicates, thumbnails, logos and pages that say nothing.

## Step 4 — write the result

Write `.lead-research/result.json`:

```json
{
  "summary": "One paragraph, 90-160 words. What the property is, what stands on it, what the records say that matters for THIS inquiry, the biggest constraint or risk, and how it fits their scope, budget and timing.",
  "match": { "confidence": "high | medium | low", "parcel": "260231003000", "note": "Why you are sure (or not) that this is their property." },
  "proposals": [
    { "target": "job", "fieldId": "22PZqic3eET3", "value": "1978", "source": "https://…", "note": "Primary residence, assessor improvement #1" },
    { "target": "location", "field": "address", "value": "310 Salmon Point Rd, Lopez Island, WA 98261", "source": "https://…", "note": "The inquiry gave only the road" }
  ],
  "facts": [
    { "group": "Parcel", "label": "Parcel number", "value": "260231003000", "source": "https://…" }
  ],
  "permits": [
    { "number": "BUILD-21-0042", "type": "Residential addition", "status": "Finaled", "date": "2021-06-14", "description": "…", "source": "https://…" }
  ],
  "sources": [
    { "name": "San Juan County Assessor", "url": "https://…", "reached": true, "note": "" }
  ],
  "openQuestions": ["The septic design is for 2 bedrooms; the inquiry asks for a third. Confirm with the health department."],
  "files": [
    { "path": ".lead-research/files/assessor-6042-1234.jpg", "name": "Assessor photo - main house.jpg", "kind": "photo", "source": "https://…", "description": "Assessor photo of the main house, 2019" }
  ]
}
```

The rules the app enforces (a broken row is dropped and listed for the
reviewer):

- **proposals** fill JobTread. Use only the fields the briefing listed, by their
  `fieldId` and `target`. An option field takes one of its options exactly. A
  number field takes a bare number. A date is YYYY-MM-DD. The only field without
  an id is the location's `address`. Propose a field only when a source states
  it. A field that already holds a value may still be proposed when the records
  disagree; say why in `note`. Never propose Status, Lead Source, Notes, Phase
  or Job Type.
- **facts** are the app's own property fields: everything worth knowing that
  has no JobTread field. `group` is one of: Parcel, Structures, Permits &
  inspections, Land & zoning, Water & septic, Utilities & access, Hazards &
  critical areas, Ownership & sales, Taxes & value, Listing & photos, Fit with
  the inquiry, Other. Short labels ("Lot size", "Septic design capacity"),
  values with units, one fact per row.
- **Every proposal, fact and permit carries the `source` URL it came from.**
  Never fill a value from memory or inference alone. If two sources disagree,
  record both in the fact's value and add an open question.
- **files** name files under `.lead-research/`. `name` is how it will read in
  JobTread: "<Source> - <what> - <year>.<ext>".

## Step 5 — submit, then report

```
node scripts/lead-research/agent.mjs submit .lead-research/result.json
```

It uploads the files, then the dossier, and prints what the app kept and left
out. Fix and resubmit only if it failed outright.

If you cannot finish (the property cannot be found, every source refused), run
`fail` with one sentence the office can act on, instead of submitting an empty
dossier.

End with three lines: the lead and parcel, how many fields, facts and files
were penciled in, and the one thing the reviewer must check first.
