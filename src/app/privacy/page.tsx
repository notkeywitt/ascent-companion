import { PageTitle } from "@/components/PageTitle";

export const metadata = {
  title: "Privacy Policy — Ascent Assistant",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-sm leading-relaxed">
      <PageTitle size="2xl">Privacy Policy</PageTitle>
      <p className="mt-1 text-neutral-500">
        Ascent Assistant browser extension &amp; web app · Ascent Building Co.
      </p>
      <p className="mt-1 text-xs text-neutral-400">Last updated: July 5, 2026</p>

      <section className="mt-6 space-y-3">
        <p>
          Ascent Assistant is an internal tool for Ascent Building Co. staff. It
          works alongside JobTread to show a job&apos;s vendor bills and billing
          information in a side panel and mobile web app. This policy explains
          what the extension and app do with data.
        </p>
      </section>

      <h2 className="mt-8 text-lg font-semibold">What we access</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5">
        <li>
          <b>The JobTread job you are viewing.</b> On{" "}
          <code>app.jobtread.com</code> pages, the extension reads the job and
          document identifiers from the page URL so the side panel can show the
          matching job. It does not read any other page content, and it does not
          run on any other website.
        </li>
        <li>
          <b>Your Google account email.</b> The web app uses Google Sign-In only
          to confirm you are on the Ascent staff allowlist. We store your email
          address to control access; we do not access your Google contacts,
          files, or any other Google data.
        </li>
        <li>
          <b>Job and billing data from JobTread.</b> The app reads and writes
          bills, invoices, and cost data through JobTread&apos;s API using
          Ascent&apos;s own credentials, on your behalf, to do the work you
          initiate in the app.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">How data is stored</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5">
        <li>
          The currently-open job identifier is kept in your browser&apos;s local
          extension storage so the panel can follow you between jobs. It never
          leaves your browser except to load the assistant app for that job.
        </li>
        <li>
          The web app stores operational records you create (such as RFIs and
          feature requests) and the staff access allowlist in its own database.
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">What we do not do</h2>
      <ul className="mt-2 list-disc space-y-2 pl-5">
        <li>We do not sell or rent your data to anyone.</li>
        <li>
          We do not share your data with third parties except the services
          required to run the app (JobTread, Google Sign-In, and our hosting and
          database providers), used solely to operate the tool.
        </li>
        <li>We do not use your data for advertising or tracking.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Contact</h2>
      <p className="mt-2">
        Questions about this policy or your data? Contact Ascent Building Co. at{" "}
        <a
          href="mailto:office@ascentbuildingco.com"
          className="font-semibold underline"
        >
          office@ascentbuildingco.com
        </a>
        .
      </p>
    </main>
  );
}
