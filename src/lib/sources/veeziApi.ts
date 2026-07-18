import "server-only";

/**
 * Veezi's real API, which the public ticketing embed cannot give us.
 *
 * Scraping the embed only shows a rolling window of dates, so a film's opening
 * date has to be inferred and its end has to be guessed. The API answers both
 * properly:
 *   - Film.OpeningDate is the actual opening date.
 *   - Session.FeatureEndTime is a real end time, so an event no longer has to
 *     repeat its start as its end.
 *   - Film.FilmPosterUrl is a full-size poster rather than the embed's thumbnail.
 *
 * It still has no film-level "runs until" date, so a film's true END is only
 * confirmed when it stops appearing (see apolloTracking).
 *
 * Needs a Veezi API access token, which is NOT the public site token used by the
 * ticketing embed. It is generated in Veezi admin and sent as VeeziAccessToken.
 */
const BASE = "https://api.us.veezi.com";

export type VeeziApiFilm = {
  Id: string;
  Title: string;
  OpeningDate: string | null;
  Rating: string | null;
  Duration: number | null;
  Synopsis: string | null;
  FilmPosterUrl: string | null;
  FilmPosterThumbnailUrl: string | null;
  BackdropImageUrl: string | null;
  Status: string | null;
};

export type VeeziApiSession = {
  Id: string;
  FilmId: string;
  Title: string | null;
  Status: string | null;
  FeatureStartTime: string | null;
  FeatureEndTime: string | null;
};

export function hasVeeziApiToken(): boolean {
  return Boolean(process.env.APOLLO_VEEZI_API_TOKEN);
}

async function get<T>(path: string): Promise<T | null> {
  const token = process.env.APOLLO_VEEZI_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { VeeziAccessToken: token, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    // 403 is what Veezi returns for a missing or invalid access token.
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export const fetchVeeziFilms = () => get<VeeziApiFilm[]>("/v4/film");
export const fetchVeeziSessions = () => get<VeeziApiSession[]>("/v1/session");

/** Films keyed by id, with only what the announcement needs. */
export async function fetchVeeziFilmIndex() {
  const films = await fetchVeeziFilms();
  if (!films?.length) return null;
  return new Map(
    films.map((f) => [
      String(f.Id),
      {
        title: f.Title,
        openingDate: f.OpeningDate ? f.OpeningDate.slice(0, 10) : null,
        poster: f.FilmPosterUrl || f.FilmPosterThumbnailUrl || f.BackdropImageUrl || null,
        rating: f.Rating ?? null,
      },
    ]),
  );
}
