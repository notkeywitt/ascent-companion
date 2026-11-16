import { ResearchReview } from "./ResearchReview";

export const metadata = { title: "Property research" };

/** One lead's property dossier: review the penciled-in values, then approve. */
export default async function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResearchReview id={id} />;
}
