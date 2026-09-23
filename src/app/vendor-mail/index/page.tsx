import VendorMailIndex from "./VendorMailIndex";

// Server shell — the client component reads /api/vendor-mail/seed and writes
// through /api/vendor-details, so no JobTread credential reaches the browser.
export default function VendorMailIndexPage() {
  return <VendorMailIndex />;
}
