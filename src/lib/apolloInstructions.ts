/** The canonical source's rolling-lineup rules, also used for its saved prompt. */
export const APOLLO_SOURCE_INSTRUCTIONS = `Apollo Theatre, 19 East College Street, Oberlin, OH 44074, operated by Cleveland Cinemas.

These rules replace older Apollo examples and generic title/venue grouping, description-date, and duplicate-report rules.

READ THE SCHEDULE
Read the WHOLE configured Veezi sessions page within the source's lookahead. Read every film and every visible show date; do not assume a fixed number of films. The date and film tabs repeat the same data. Ignore unrelated MovieTheater metadata and use the venue details above. Consolidate repeated rows by actual film title, preserving sequel numbers and each film's own earliest and latest visible dates. A movie that began earlier and still has future showings is ongoing, not expired. Never mistake the rolling page's first visible day for a verified premiere. Skip films with no showings after today. Do not invent dates beyond the visible schedule.

ANNOUNCEMENT WINDOWS
Look forward from tomorrow. Make a new Playing Now at the Apollo window whenever the set of films changes: start on an opening day, or on the day AFTER another film's last visible date. Keep each window's lineup exact. Ordinary closed days inside a film's listed date range do not create another announcement. Follow the contiguous sequence of windows; films opening after a gap in that sequence belong in Coming Soon at the Apollo, one announcement per opening date. Do not announce the same film twice in Coming Soon if it is already represented in a Playing Now window.

Example: today Jul 20; Moana Jul 21-23, The Odyssey Jul 21-29, Young Washington Jul 24-30, Spider-Man: Brand New Day Jul 30, and a separate future film opening Aug 5 after a gap. Playing Now windows are Jul 21-23 (Moana, The Odyssey), Jul 24-29 (The Odyssey, Young Washington), and Jul 30 (Young Washington, Spider-Man: Brand New Day). The Aug 5 film is Coming Soon, if within the configured lookahead. Do not carry The Odyssey into Jul 30. Use the full calendar year from the run context; handle Dec/Jan correctly.

CONTENT
Every payload is eventType an, category Film (5), sponsor Apollo Theater, locationType ph2, location 19 East College Street, Oberlin, OH 44074, placeName Apollo Theatre. Titles are Playing Now at the Apollo or Coming Soon at the Apollo. description is the film lineup, not generic prose: Film title: Sep 1 to Sep 9 . Other film: Sep 1 to Sep 9; Coming Soon uses Film title: opens Sep 10. Use each film's OWN dates, not the shared window bounds. Dates are allowed here in the short description only. Leave extendedDescription empty. Preserve every film title, including sequel numbers; if a lineup exceeds 200 characters, flag it rather than dropping a film or truncating a title. Sessions are the announcement's window, first day 00:00 through last day 23:59, ISO local wall-clock strings. For a Coming Soon entry use its verified opening date as the display session; do not invent an earlier posting window.

IMAGES AND LINKS
Give imageUrls with one real poster for each film in the lineup; the server combines them. Prefer official posters; the source's own Veezi posters are valid fallbacks. contactEmail apollo@clevelandcinemas.com; phone 440-774-3920; website https://www.clevelandcinemas.com/our-locations/x03gq-apollo-theatre/. calendarSourceUrl and a Buy Tickets button use the configured Veezi listing. These shared theater/listing URLs are NOT identities for individual announcements.

DUPLICATE EVIDENCE
Return every complete Apollo announcement in events, including ones already in either inventory. Keep duplicates empty. The server checks the actual film lineup, announcement kind, individual film dates, and covered display window. Never collapse different lineups because they share a title, venue, URL, poster, or some films. An unchanged lineup inside an already-covered window can be a duplicate. Changed films, changed film end/open dates, and newly uncovered windows require review; do not silently discard them or extend old content. Preserve complete descriptions, dates and images so a reviewer can audit every comparison.`;
