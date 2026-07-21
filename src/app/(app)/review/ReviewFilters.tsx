"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, Icon } from "@/components/ui";
import { EVENT_TYPES } from "@/lib/taxonomy";

export function ReviewFilters({ sources }: { sources: { id: number; name: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const activeQuery = params.get("q") ?? "";
  const [query, setQuery] = useState(activeQuery);

  const apply = useCallback(
    (next: Record<string, string>) => {
      const search = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value) search.set(key, value);
        else search.delete(key);
      }
      const suffix = search.toString();
      router.push(suffix ? `/review?${suffix}` : "/review");
    },
    [params, router],
  );

  // Search as you type. It used to wait for the Enter key, with no button and
  // nothing on screen saying so, so typing a word and watching the list not
  // change looked exactly like a broken search.
  useEffect(() => {
    if (query.trim() === activeQuery) return;
    const timer = setTimeout(() => apply({ q: query.trim() }), 350);
    return () => clearTimeout(timer);
  }, [query, activeQuery, apply]);

  return (
    <div className="filter-bar" aria-label="Review filters">
      <form onSubmit={(event) => { event.preventDefault(); apply({ q: query }); }} className="filter-bar__search">
        <label className="sr-only" htmlFor="review-search">Search events</label>
        <Icon name="search" />
        <input
          id="review-search"
          name="query"
          className="input"
          type="search"
          autoComplete="off"
          placeholder="Search title or location…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <label className="sr-only" htmlFor="source-filter">Filter by source</label>
      <select id="source-filter" name="source" className="input" value={params.get("source") ?? ""} onChange={(event) => apply({ source: event.target.value })}>
        <option value="">All Sources</option>
        {sources.map((source) => <option key={source.id} value={String(source.id)}>{source.name}</option>)}
      </select>
      <label className="sr-only" htmlFor="type-filter">Filter by event type</label>
      <select id="type-filter" name="eventType" className="input" value={params.get("type") ?? ""} onChange={(event) => apply({ type: event.target.value })}>
        <option value="">All Types</option>
        {EVENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
      </select>
      {(params.get("q") || params.get("source") || params.get("type")) && (
        <Button size="sm" variant="ghost" type="button" onClick={() => { setQuery(""); router.push(`/review${params.get("tab") ? `?tab=${params.get("tab")}` : ""}`); }}>Clear Filters</Button>
      )}
    </div>
  );
}
