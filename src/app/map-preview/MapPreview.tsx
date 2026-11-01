"use client";

import { useEffect, useState } from "react";

import { LopezMap } from "@/components/LopezMap";
import { Banner, Card, ListCard, ListRow, Loading, PageHeader } from "@/components/ui";
import type { MapJob } from "@/lib/lopezMap";

export function MapPreview() {
  const [jobs, setJobs] = useState<MapJob[] | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/jobs?withPhase=1")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setJobs(d.jobs)))
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-4">
      <PageHeader title="Map preview" description="The Lopez Island map, on its own. Select a job to ring its dot." />
      {error && <Banner tone="error">{error}</Banner>}
      {!jobs && !error && <Loading />}
      {jobs && (
        <div className="grid gap-4 md:grid-cols-[1fr_380px]">
          <ListCard>
            {jobs.map((j) => (
              <ListRow
                key={j.id}
                label={j.name}
                desc={j.phase ?? "No phase"}
                selected={j.id === selectedId}
                chevron={false}
                onClick={() => setSelectedId(j.id === selectedId ? null : j.id)}
              />
            ))}
          </ListCard>
          <Card className="self-start md:sticky md:top-4">
            <LopezMap jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} />
          </Card>
        </div>
      )}
    </div>
  );
}
