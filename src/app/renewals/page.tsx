import { Renewals } from "./Renewals";

export const metadata = { title: "Renewals" };

export default function RenewalsPage() {
  return (
    <main className="w-full max-w-2xl pad:max-w-5xl px-4 pad:px-7 pb-24 pt-6">
      <Renewals />
    </main>
  );
}
