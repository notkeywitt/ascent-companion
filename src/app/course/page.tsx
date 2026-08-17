import { CourseHome } from "./CourseHome";

/**
 * "Reading Your Own App" — the in-app course. A guided walk through this
 * codebase for the owner. Server component hands off to the client home, which
 * reads reading-progress from the browser.
 *
 * Gated by the "course" view in src/lib/views.ts (office + admin by default).
 * The written source of record is docs/course/*.md.
 */
export default function CoursePage() {
  return <CourseHome />;
}
