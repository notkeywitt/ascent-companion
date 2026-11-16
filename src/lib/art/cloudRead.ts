import { unstable_cache } from "next/cache";
import { getPaveConfig } from "@/lib/config";
import { getArtRows } from "@/lib/jobtread";
import { buildCloud, CLOUD_SPECS, type CloudPayload, type CloudSetId } from "@/lib/art/cloud";
import { cloudRecords, type ArtRows } from "@/lib/art/rows";

/**
 * The /art reads, cached for an hour per data set: the pictures are art, not
 * a ledger, and a read is about twenty Pave pages. Server-only.
 */
export const readRows = unstable_cache(
  async <S extends CloudSetId>(set: S): Promise<ArtRows[S]> => getArtRows(getPaveConfig(), set),
  ["art-rows-v2"],
  { revalidate: 3600, tags: ["jt-art"] },
) as <S extends CloudSetId>(set: S) => Promise<ArtRows[S]>;

/** One Cost Cloud data set as PCA points. Built from the cached rows. */
export const readCloud = unstable_cache(
  async (set: CloudSetId): Promise<CloudPayload> =>
    buildCloud(CLOUD_SPECS[set], cloudRecords(set, await readRows(set))),
  ["art-cloud-v3"],
  { revalidate: 3600, tags: ["jt-art"] },
);

export function isCloudSet(v: string | null): v is CloudSetId {
  return v === "bills" || v === "labor" || v === "budget";
}
