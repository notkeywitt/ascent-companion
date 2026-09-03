import { ClientsBrowser } from "./ClientsBrowser";

/**
 * Clients & Jobs — the JobTread customer and job directory, editable.
 *
 * Nothing to inject: every read and every write goes through `/api/clients*`,
 * which is where the grant key lives. Gated by the "clients" view in
 * src/lib/views.ts (office + admin).
 */
export default function ClientsPage() {
  return <ClientsBrowser />;
}
