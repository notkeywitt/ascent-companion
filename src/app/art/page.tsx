import { ListCard, ListRow, PageHeader } from "@/components/ui";
import { ART_PROJECTS } from "@/lib/art/projects";

/** Art that Makes Itself — a gallery of pictures drawn from the company's own
 *  data. Admin only (the `art` view). Each piece is its own page. */
export default function ArtPage() {
  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 pb-24 pt-6">
      <PageHeader
        title="Art that Makes Itself"
        description="Pictures the company's own data draws. Each one reads JobTread live."
      />
      <ListCard>
        {ART_PROJECTS.map((p) => (
          <ListRow key={p.slug} href={p.href} label={p.title} desc={p.desc} wrap />
        ))}
      </ListCard>
    </main>
  );
}
