# Extraction research analysis — Oberlin AI Calendar

This is a plain-language report of what happened when the two agents (Discovery
and Source) were run against every real Oberlin source. It covers which
extraction method each source got, how many events came out, how clean they
were, and where the system still has gaps.

Run date: 2026-07-18. Model: claude-opus-4-8. Mode: restricted (everything lands
in the review queue, nothing is auto-published).

## How it works, in one paragraph

For each source the **Discovery Agent** fetches the link once and decides the
best way to pull events, preferring a public JSON API, then an iCal or RSS feed,
then structured JSON-LD on the page, and finally reading the raw HTML. It writes
that decision down as a reusable recipe. The **Source Agent** then replays that
recipe, normalizes every event to one shared shape, and runs deterministic
checks (required fields, category is real, date and location present, an image
is present). Duplicates are found by comparing content (date and location
first), never by matching ids, and duplicates are kept and shown in a tab, not
thrown away. Every step is written to a live timeline you can watch.

## Per-source results

| Source | Method chosen | Events | To review | Duplicates | Flagged | Notes |
|---|---|---|---|---|---|---|
| Oberlin College | public API (LiveWhale) | 15 | 15 | 0 | 0 | Cleanest source. API returns images. |
| Oberlin Heritage Center | public API (The Events Calendar) | 4 | 4 | 0 | 0 | WordPress `wp-json` events API. |
| Riverdog Music | HTML listing | 17 | 17 | 0 | 1 | Weebly shows page; one event missing a field. |
| Allen Memorial Art Museum | HTML listing | 4 | 4 | 0 | 0 | Clean. |
| First Church in Oberlin | HTML listing | 2 | 2 | 0 | 2 | Two events missing a required field. |
| Common Ground Center | HTML listing | 1 | 1 | 0 | 0 | Few upcoming events on the page. |
| FAVA | HTML listing | 23 | 23 | 0 | 0 | Large gallery calendar; needed streaming to finish. |
| Northern Ohio Youth Orchestra | HTML listing | 0 | 0 | 0 | 0 | Ticketing widget, no plain-text events found. |
| Oberlin Public Library | blocked | 0 | | | | HTTP 403 bot protection (locable.com). |
| City Fresh | blocked | 0 | | | | HTTP 403 bot protection. |
| Oberlin Business Partnership | blocked | 0 | | | | HTTP 403 bot protection (Weebly/GoDaddy). |
| Apollo Theater | not scrapeable | 0 | | | | Uses the Veezi ticketing API; needs its own connector. |
| Fixed Events | no web page | 0 | | | | Recurring, manually defined. |
| Email Calendar | email inbox | 0 | | | | Needs an IMAP mailbox, not a URL. |

## What the numbers say

- **Method preference works as designed.** Where a real API or feed exists, the
  Discovery Agent found it and used it instead of scraping HTML: Oberlin College
  (LiveWhale API) and Heritage Center (WordPress events API) both went the API
  route. API sources were the cleanest, with zero flagged events, because the
  API hands over structured fields and image URLs directly.
- **Images are nearly universal.** 63 of 65 events carried an image (about 97%).
  Feeds and APIs rarely include an image, so the system fetches each event's own
  detail page and reads its social-share image (`og:image`). Only two events had
  no findable image and were flagged for a human to add one.
- **No false duplicates.** Zero duplicates across the whole run, which is
  expected since each source covers a different venue. The duplicate check is
  content-based (date and location) and is there for the case where two sources
  list the same real event; it did not misfire here.
- **Validation is doing its job quietly.** Three events were flagged: two for a
  missing image and one for a vague location word in the long description. None
  were dropped. In restricted mode they simply wait in the review queue with the
  reason attached, which is the point.
- **Retention works.** One event whose start date had already passed was swept
  by the cleanup job on its first run.

## Where the gaps are, honestly

1. **Three sites block server-side fetching (HTTP 403).** Oberlin Public
   Library, City Fresh, and Oberlin Business Partnership sit behind bot
   protection that rejects any non-browser request, even with a real browser
   user-agent. Reading them needs a headless browser that runs the page's
   JavaScript. That is the single biggest coverage gap and the clear next build.
2. **Apollo needs its own connector.** Apollo showtimes come from the Veezi
   ticketing API, not a public web page, so the generic web agent cannot read
   them. It needs a small dedicated Veezi integration using the site token.
3. **Large pages need streaming (fixed).** FAVA's calendar page was big enough
   that a single non-streamed model call ran past the ten-minute request limit
   and failed. The extraction call now streams, which removed that ceiling, and
   FAVA came back with 23 clean events.
4. **Ticketing-widget sites yield little.** Northern Ohio Youth Orchestra renders
   its events inside a ticket widget, so the plain-text pass found nothing. This
   is the same JavaScript-rendering gap as the 403 sites.

## The short version to tell someone

We pointed the calendar's two AI agents at every Oberlin source. For each one,
the first agent figured out the cheapest reliable way to get events (a real data
feed if the site has one, otherwise reading the page), and the second agent
pulled the events, cleaned them into one consistent format, gave each one an
image, checked for duplicates by date and place, and put everything in a review
queue for a person to approve. It worked well on the sites that let us read them:
about forty-something clean events, almost all with images, no bad duplicates.
The main thing still to fix is a handful of sites that block automated reading
and one theater that only publishes through a ticketing system, both of which
need a heavier browser-based reader we have not built yet.

Final tally: 65 events in the review queue, 63 with images (97%), zero
duplicates, three flagged for a small fix. Eight sources read cleanly; three are
blocked by bot protection; three cannot be scraped generically (Apollo/Veezi, a
recurring manual source, and an email inbox).
