import { MapPreview } from "./MapPreview";

/**
 * A scratch page for <LopezMap>, until the desktop board takes it in. Admin
 * only ("map-preview" in lib/views). Delete this route and its view once the
 * map lives on the board.
 */
export default function MapPreviewPage() {
  return <MapPreview />;
}
