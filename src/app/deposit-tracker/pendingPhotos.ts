/**
 * The photos a Home camera button took, handed to the page that uses them:
 * "Deposit check" to /deposit-tracker, "Add bill" to /add-bill.
 *
 * The camera has to open from a tap — a page cannot open it on load — so Home
 * takes the first photos and this module carries them across the client-side
 * navigation. Module state survives `router.push`; a full reload empties it,
 * and the page then offers its own camera button.
 */
type Target = "deposit-tracker" | "add-bill";
let pending: { files: File[]; target: Target } | null = null;

export function setPendingPhotos(files: File[], target: Target): void {
  pending = { files, target };
}

/** The photos for `target`, once. A second read gets nothing, so a revisit starts clean. */
export function takePendingPhotos(target: Target): File[] {
  if (!pending || pending.target !== target) return [];
  const out = pending.files;
  pending = null;
  return out;
}

/**
 * A phone photo as a JPEG no wider than 2000px. An iPhone hands over HEIC,
 * 3–5 MB; Safari can still decode it, so drawing it to a canvas and
 * re-encoding gives a JPEG every reader opens, at a few hundred KB — under
 * Vercel's 4.5 MB request cap. Same technique as /add-bill. Returns the file
 * untouched when the browser cannot decode it.
 */
export async function shrinkPhoto(f: File, name: string): Promise<File> {
  try {
    const bitmap = await createImageBitmap(f);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return f;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], name, { type: "image/jpeg" }) : f;
  } catch {
    return f;
  }
}
