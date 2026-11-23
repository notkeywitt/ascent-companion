import { ChangeOrders } from "./ChangeOrders";

/**
 * Change Orders: every change order from 2026-11-23 on, grouped by job, and
 * New CO (a draft change order in JobTread). Gated by the "change-orders" view.
 */
export default function Page() {
  return <ChangeOrders />;
}
