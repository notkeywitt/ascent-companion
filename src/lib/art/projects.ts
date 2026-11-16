/**
 * The pieces on "Art that Makes Itself" (/art), in gallery order. A new piece
 * is a page under src/app/art/<slug>/ plus one entry here. Every piece rides the
 * `art` view (admin), because /art is a path prefix in views.ts.
 */
export interface ArtProject {
  slug: string;
  title: string;
  desc: string;
  href: string;
}

export const ART_PROJECTS: ArtProject[] = [
  {
    slug: "cloud",
    title: "Cost Cloud",
    desc: "Every bill line, time entry or budget line as one dot, placed by PCA and coloured by cluster",
    href: "/art/cloud",
  },
];
