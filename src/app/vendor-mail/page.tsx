import VendorMail from "./VendorMail";

// Server shell — the data and UI live in the client component, which reads
// /api/vendor-mail (the JobTread grant key never leaves the server).
export default function VendorMailPage() {
  return <VendorMail />;
}
