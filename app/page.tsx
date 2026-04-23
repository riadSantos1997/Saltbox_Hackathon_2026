export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Profile Permission Comparator</h1>
      <p className="mt-2 text-sm text-gray-600">
        Saltbox S1 hackathon MVP — critical-path server implementation.
      </p>
      <section className="mt-6 space-y-3 text-sm leading-6">
        <p>
          This build delivers the server-side critical path for comparing
          Salesforce profile permissions between two orgs:
        </p>
        <ul className="list-disc pl-6">
          <li>
            <code>POST /api/salesforce/scrape</code> — scrape permissions from
            both orgs in parallel (Tooling API).
          </li>
          <li>
            <code>POST /api/export</code> — generate the XLSX diff report.
          </li>
          <li>
            <code>POST /api/pipeline</code> — end-to-end scrape + diff + export
            in one call (D4 convergence endpoint).
          </li>
        </ul>
        <p className="text-gray-500">
          The conversational chat UI (Stream C) and AI SDK orchestration
          (Stream D, tasks D1–D3) are intentionally out of scope for this
          critical-path implementation.
        </p>
      </section>
    </main>
  );
}
