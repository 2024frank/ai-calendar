"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { Button, Icon } from "@/components/ui";
import { EVENT_TYPES } from "@/lib/taxonomy";

export function ReviewFilters({ sources }: { sources: { id: number; name: string }[] }) {
  const params = useSearchParams();
  const activeQuery = params.get("q") ?? "";
  return (
    <ReviewFiltersBody
      sources={sources}
      activeQuery={activeQuery}
      paramsString={params.toString()}
    />
  );
}

function ReviewFiltersBody({
  sources,
  activeQuery,
  paramsString,
}: {
  sources: { id: number; name: string }[];
  activeQuery: string;
  paramsString: string;
}) {
  const router = useRouter();
  const params = new URLSearchParams(paramsString);
  const queryInput = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Browser Back/Forward can replace the URL query independently of this input.
  // Keep the inexpensive input uncontrolled and synchronize the DOM value. This
  // preserves focus; keying/remounting it after each search dropped the cursor.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (queryInput.current && queryInput.current.value !== activeQuery) {
      queryInput.current.value = activeQuery;
    }
  }, [activeQuery, paramsString]);

  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const apply = useCallback(
    (next: Record<string, string>, replace = false) => {
      const search = new URLSearchParams(paramsString);
      for (const [key, value] of Object.entries(next)) {
        if (value) search.set(key, value);
        else search.delete(key);
      }
      const suffix = search.toString();
      const href = suffix ? `/review?${suffix}` : "/review";
      if (replace) router.replace(href);
      else router.push(href);
    },
    [paramsString, router],
  );

  function scheduleSearch(value: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const query = value.trim();
    if (query === activeQuery) return;
    searchTimer.current = setTimeout(() => {
      searchTimer.current = null;
      apply({ q: query }, true);
    }, 350);
  }

  function applyWithCurrentQuery(next: Record<string, string>) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
    apply({ ...next, q: queryInput.current?.value.trim() ?? "" });
  }

  return (
    <div className="filter-bar" aria-label="Review filters">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (searchTimer.current) clearTimeout(searchTimer.current);
          searchTimer.current = null;
          apply({ q: queryInput.current?.value.trim() ?? "" });
        }}
        className="filter-bar__search"
      >
        <label className="sr-only" htmlFor="review-search">Search events</label>
        <Icon name="search" />
        <input
          id="review-search"
          name="query"
          className="input"
          type="search"
          autoComplete="off"
          placeholder="Search title or location…"
          ref={queryInput}
          defaultValue={activeQuery}
          onChange={(event) => scheduleSearch(event.target.value)}
        />
      </form>
      <label className="sr-only" htmlFor="source-filter">Filter by source</label>
      <select id="source-filter" name="source" className="input" value={params.get("source") ?? ""} onChange={(event) => applyWithCurrentQuery({ source: event.target.value })}>
        <option value="">All Sources</option>
        {sources.map((source) => <option key={source.id} value={String(source.id)}>{source.name}</option>)}
      </select>
      <label className="sr-only" htmlFor="type-filter">Filter by event type</label>
      <select id="type-filter" name="eventType" className="input" value={params.get("type") ?? ""} onChange={(event) => applyWithCurrentQuery({ type: event.target.value })}>
        <option value="">All Types</option>
        {EVENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
      </select>
      {(params.get("q") || params.get("source") || params.get("type")) && (
        <Button size="sm" variant="ghost" type="button" onClick={() => {
          if (searchTimer.current) clearTimeout(searchTimer.current);
          searchTimer.current = null;
          if (queryInput.current) queryInput.current.value = "";
          router.push(`/review${params.get("tab") ? `?tab=${params.get("tab")}` : ""}`);
        }}>Clear Filters</Button>
      )}
    </div>
  );
}
