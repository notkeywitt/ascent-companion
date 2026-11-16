import { unstable_cache } from "next/cache";
import { getPaveConfig } from "@/lib/config";
import { getArtCloudRecords } from "@/lib/jobtread";
import { buildCloud, CLOUD_SPECS, type CloudPayload, type CloudSetId } from "@/lib/art/cloud";

/**
 * One Cost Cloud data set, read from JobTread and turned into PCA points.
 * Cached for an hour per set: the picture is art, not a ledger, and a read is
 * about twenty Pave pages. Server-only.
 */
export const readCloud = unstable_cache(
  async (set: CloudSetId): Promise<CloudPayload> =>
    buildCloud(CLOUD_SPECS[set], await getArtCloudRecords(getPaveConfig(), set)),
  ["art-cloud-v1"],
  { revalidate: 3600, tags: ["jt-art-cloud"] },
);

export function isCloudSet(v: string | null): v is CloudSetId {
  return v === "bills" || v === "labor" || v === "budget";
}
