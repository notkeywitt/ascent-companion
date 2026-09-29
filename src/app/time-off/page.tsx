import { TimeOffView } from "./TimeOff";

/** Time Off — everyone's own balance and requests. The office console is /time-off/office. */
export default function TimeOffPage() {
  return <TimeOffView office={false} />;
}
