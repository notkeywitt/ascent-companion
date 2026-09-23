"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { JtLink } from "@/components/JtLink";
import { useAccess } from "@/components/AccessProvider";
import { Button, Input, btn } from "@/components/ui";

/**
 * The unmatched-vendor alert — the loud half of a failure that used to be silent.
 *
 * A bill imported from a Gmail tag ("_JT Invoice <Customer> - <Job>") writes its
 * Expenditure row fine and THEN fails to push, because its vendor doesn't
 * resolve to a JobTread account (JobTread.js: "No JT Account ID for vendor …").
 * The row is stamped "Push Failed", the 15-minute tag scan retries it forever,
 * and the only evidence is a line in the Audit Log that nobody reads — so the
 * office believes the invoice is in JobTread when it isn't.
 *
 * The fix is always the same and always one step: CREATE THE VENDOR IN JOBTREAD.
 * The next push pulls the new account in and heals every stuck row on its own
 * (the vendor self-heal, JobTread.js section 6A-ii) — no re-tagging, no
 * re-import.
 *
 * So the popup does exactly that one step, in place: "Create vendor" posts to
 * /api/vendor-create, which refuses a name JobTread already has, files the
 * address the bill ARRIVED FROM on the new account, and runs Sync Vendors so the
 * sheet learns the account id — without which the bill stays stuck however many
 * vendors exist. Filing the address is what keeps the vendor-mail check able to
 * see this vendor from day one. The link to JobTread stays for everything this
 * cannot do (a name that already exists, two rows pointing at two accounts).
 *
 * Three exports, one fetch:
 *   StuckVendorsProvider — mounted in the root layout; fetches once per load.
 *   StuckVendorPopup     — modal, also in the layout, so the warning finds you
 *                          on whatever page you opened. Dismissible for the
 *                          session, but a NEW unmatched vendor re-opens it (the
 *                          dismissal is keyed to the vendor list, not the day).
 *   StuckVendorBanner    — permanent card on the Home launcher, so dismissing
 *                          the popup hides the interruption, not the problem.
 *
 * Gated on the `email` view — the same gate as /api/stuck-vendors, so nobody
 * sees a warning about a queue they have no access to fix.
 */

/** JobTread's vendor list — where the fix happens. */
export const JT_VENDORS_URL = "https://app.jobtread.com/vendors";

export interface StuckBill {
  expId: string;
  amount: number;
  date: string;
  status: string;
  driveUrl: string;
  /** Came in from Gmail (add-on / "_JT Invoice …" tag) rather than the sweep. */
  fromEmail: boolean;
  /** The address it arrived from, when the row records a Gmail message. */
  fromAddress?: string;
}

export interface StuckVendor {
  /** The vendor name as extracted — what to create in JobTread. */
  vendor: string;
  /**
   * Why THIS name doesn't resolve, from the Apps Script action. "Create the
   * vendor" is the usual answer but not the only one — two Vendors rows can
   * point at two different JobTread vendors, which no amount of creating fixes.
   * Optional: older deployments of the script don't send it.
   */
  reason?: string;
  count: number;
  taggedCount: number;
  bills: StuckBill[];
  /** The address most of this vendor's stuck bills came from — what "Create
   *  vendor" files on the new account. Absent on older script deployments. */
  senderEmail?: string;
}

interface StuckVendorsValue {
  vendors: StuckVendor[];
  billCount: number;
  loading: boolean;
  error: string;
  refresh: () => void;
}

const EMPTY: StuckVendorsValue = {
  vendors: [],
  billCount: 0,
  loading: false,
  error: "",
  refresh: () => {},
};

const StuckVendorsContext = createContext<StuckVendorsValue>(EMPTY);

export function useStuckVendors(): StuckVendorsValue {
  return useContext(StuckVendorsContext);
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Session key for the popup dismissal, keyed to WHICH vendors are stuck. */
const DISMISS_KEY = "ascent.stuckVendors.dismissed";
const signatureOf = (vendors: StuckVendor[]) =>
  vendors
    .map((v) => v.vendor.toLowerCase())
    .sort()
    .join("|");

/* ---------------------------------------------------------------- provider */

export function StuckVendorsProvider({ children }: { children: ReactNode }) {
  const access = useAccess();
  const canSee = access.can("email");

  const [vendors, setVendors] = useState<StuckVendor[]>([]);
  const [billCount, setBillCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!canSee) return;
    let alive = true;
    setLoading(true);
    setError("");
    // The first load may answer from the route's 60s shared cache; an explicit
    // Refresh (nonce > 0) must not — that click means "look again now".
    fetch(nonce > 0 ? "/api/stuck-vendors?refresh=1" : "/api/stuck-vendors")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.ok === false || j.error) {
          setError(String(j.error ?? "Could not check vendors"));
          return;
        }
        setVendors(Array.isArray(j.vendors) ? j.vendors : []);
        setBillCount(typeof j.billCount === "number" ? j.billCount : 0);
      })
      // A failed check must never break the page it's mounted on — the alert is
      // additive. Record it; the banner shows it, the popup stays shut.
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Network error");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [canSee, nonce]);

  const value = useMemo<StuckVendorsValue>(
    () => ({ vendors, billCount, loading, error, refresh }),
    [vendors, billCount, loading, error, refresh],
  );

  return <StuckVendorsContext.Provider value={value}>{children}</StuckVendorsContext.Provider>;
}

/* -------------------------------------------------------------- create row */

/**
 * One stuck vendor, with the one action that fixes it.
 *
 * The name and the address are both editable before creating: the name is what
 * a model extracted off an invoice ("ACME SUPPLY CO." / "Acme Supply"), and the
 * address may be a `noreply@` the office would rather not file. Creating is not
 * reversible from here, so the office sees exactly what it is about to make.
 */
function StuckVendorRow({ v, onCreated }: { v: StuckVendor; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(v.vendor);
  const [email, setEmail] = useState(v.senderEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [made, setMade] = useState<{ name: string; synced: boolean; warning?: string } | null>(null);

  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/vendor-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "Could not create the vendor.");
      setMade({ name: json.vendor?.name ?? name, synced: json.synced === true, warning: json.warning });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-line px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 break-words font-semibold">{v.vendor}</span>
        <span className="shrink-0 text-xs text-neutral-500">
          {v.count} bill{v.count === 1 ? "" : "s"}
        </span>
      </div>
      {v.reason && <p className="mt-1 text-xs text-neutral-500">{v.reason}</p>}
      <ul className="mt-1 space-y-0.5">
        {v.bills.slice(0, 3).map((b) => (
          <li key={b.expId} className="font-mono text-xs text-neutral-500">
            {b.expId} · {money(b.amount)}
            {b.date ? " · " + b.date : ""}
          </li>
        ))}
        {v.bills.length > 3 && <li className="text-xs text-neutral-500">+{v.count - 3} more</li>}
      </ul>

      {made ? (
        <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          ✓ Created {made.name}.{" "}
          {made.warning ? (
            <span className="font-normal text-amber-700 dark:text-amber-400">{made.warning}</span>
          ) : made.synced ? (
            <span className="font-normal text-neutral-500">
              Vendors synced — the next push sends {v.count === 1 ? "this bill" : "these bills"}.
            </span>
          ) : null}
        </p>
      ) : open ? (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Vendor name
            </span>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Email {v.senderEmail ? "(where their bill came from)" : "(optional)"}
            </span>
            <Input
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="billing@vendor.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          {error && (
            <p className="text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create in JobTread"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="mt-2" onClick={() => setOpen(true)}>
          Create vendor{v.senderEmail ? " + file their email" : ""}
        </Button>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------- popup */

export function StuckVendorPopup() {
  const { vendors, billCount, refresh } = useStuckVendors();
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Read the session dismissal after mount — sessionStorage doesn't exist during
  // SSR, and reading it in render would hydrate-mismatch.
  useEffect(() => {
    try {
      setDismissedSig(sessionStorage.getItem(DISMISS_KEY));
    } catch {
      /* private mode / storage blocked — just show the popup */
    }
    setReady(true);
  }, []);

  const sig = signatureOf(vendors);
  const open = ready && vendors.length > 0 && dismissedSig !== sig;

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISS_KEY, sig);
    } catch {
      /* ignore — falls back to re-showing on the next navigation */
    }
    setDismissedSig(sig);
  }, [sig]);

  // Escape closes, matching the backdrop click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismiss]);

  if (!open) return null;

  const taggedTotal = vendors.reduce((n, v) => n + v.taggedCount, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={dismiss}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="stuck-vendor-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl dark:bg-ink-raised"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 id="stuck-vendor-title" className="text-base font-bold tracking-tight">
              {vendors.length === 1
                ? "A vendor isn’t in JobTread"
                : `${vendors.length} vendors aren’t in JobTread`}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              {billCount} bill{billCount === 1 ? "" : "s"} imported but{" "}
              <b className="font-semibold">not pushed</b> — the vendor doesn’t exist in
              JobTread yet.
              {taggedTotal > 0 && ` ${taggedTotal} came in from a Gmail tag and went no further.`}
            </p>
          </div>
        </div>

        <ul className="mt-4 space-y-2">
          {vendors.map((v) => (
            <StuckVendorRow key={v.vendor} v={v} onCreated={refresh} />
          ))}
        </ul>

        <p className="mt-4 text-sm text-neutral-500">
          Creating the vendor here files it in JobTread with the address its bill arrived from,
          then syncs the Vendors sheet — after which the next push sends the stuck bills on its own.
          Open JobTread for anything this can&apos;t do, like a name that already exists.
        </p>

        <div className="mt-4 flex items-center gap-2">
          <JtLink href={JT_VENDORS_URL} className={btn("primary", "md", "flex-1")}>
            Open JobTread Vendors ↗
          </JtLink>
          <Button variant="secondary" onClick={dismiss}>
            Later
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ banner */

/**
 * The persistent half — a card on the Home launcher. Dismissing the popup should
 * stop the interruption, not hide the problem, so this stays until the vendors
 * actually exist in JobTread.
 */
export function StuckVendorBanner() {
  const { vendors, billCount, loading, error, refresh } = useStuckVendors();
  const access = useAccess();

  if (!access.can("email")) return null;
  if (error) {
    return (
      <div className="mb-4 rounded-xl bg-neutral-100 px-4 py-3 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        Couldn’t check for unmatched vendors ({error}).{" "}
        <button type="button" onClick={refresh} className="font-semibold underline">
          Retry
        </button>
      </div>
    );
  }
  if (vendors.length === 0) return null;

  return (
    <div
      role="status"
      className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {vendors.length === 1
              ? "1 vendor isn’t in JobTread"
              : `${vendors.length} vendors aren’t in JobTread`}{" "}
            — {billCount} bill{billCount === 1 ? "" : "s"} stuck
          </p>
          <p className="mt-0.5 break-words text-xs opacity-90">
            {vendors.map((v) => v.vendor).join(", ")}
          </p>
          {/* One line per vendor when the script says WHY — "create the vendor"
              is not always the fix, and the banner used to imply it always was. */}
          {vendors.some((v) => v.reason) && (
            <ul className="mt-1 space-y-0.5">
              {vendors
                .filter((v) => v.reason)
                .map((v) => (
                  <li key={v.vendor} className="break-words text-xs opacity-90">
                    {v.reason}
                  </li>
                ))}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="shrink-0 text-xs font-semibold underline disabled:opacity-50"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>
      <JtLink
        href={JT_VENDORS_URL}
        className="mt-2 inline-block text-sm font-semibold underline"
      >
        Open JobTread Vendors ↗
      </JtLink>
    </div>
  );
}
