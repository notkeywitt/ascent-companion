/**
 * The month's bills for Notes' bill picker — the Tracking Sheets list's own
 * read (src/app/api/trackingsheet/all-bills), served under /api/notes so the
 * Jobs page's view gates it and a note writer needs no Tracking Sheets view.
 * Read-only. One handler, so the picker can never disagree with the list.
 */
export { GET } from "../../trackingsheet/all-bills/route";
