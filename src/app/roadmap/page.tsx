import { Roadmap } from "./Roadmap";

export const metadata = { title: "Roadmap" };

export default function RoadmapPage() {
  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6">
      <Roadmap />
    </main>
  );
}
