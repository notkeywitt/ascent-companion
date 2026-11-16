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
    desc: "Every bill line, time entry or budget line as one dot, placed by PCA or pulled into islands by t-SNE",
    href: "/art/cloud",
  },
  {
    slug: "weave",
    title: "Work Weave",
    desc: "Every crew hour of the year on a day-by-hour loom; it weaves itself in date order",
    href: "/art/weave",
  },
  {
    slug: "rose",
    title: "Week Rose",
    desc: "Each person's work week as a rose: one petal per hour of the week",
    href: "/art/rose",
  },
  {
    slug: "river",
    title: "Spend River",
    desc: "Weekly bill spend as a flowing stream, split by division, cost type or vendor",
    href: "/art/river",
  },
  {
    slug: "fingerprints",
    title: "Job Fingerprints",
    desc: "One radar glyph per job: the share of its spend in each division",
    href: "/art/fingerprints",
  },
  {
    slug: "words",
    title: "Line Words",
    desc: "The words on bill and budget lines, sized by the dollars behind them",
    href: "/art/words",
  },
  {
    slug: "flock",
    title: "Job Flock",
    desc: "A live flock: every row a bird, flocking with its job; jobs that share vendors or crew fly together",
    href: "/art/flock",
  },
];
