import { buildApolloAnnouncements } from "../src/lib/sources/apolloSegments";

// Fabricated schedule to show how windows split. Veezi prints dates like "Friday 18, July".
const day = (d: number) => `Weekday ${d}, July`;
const film = (title: string, days: number[]) => ({
  title, code: null, rating: null,
  showtimes: days.map((d) => ({ date: day(d), time: "7:00 PM", sessionId: "1" })),
});

// Toy Story ends Jul 22, Minions ends Jul 24, Moana opens Jul 24, Ghostbusters opens Jul 27
const films = [
  film("Toy Story", [19, 20, 21, 22]),
  film("Minions", [19, 20, 21, 22, 23, 24]),
  film("Moana", [24, 25, 26, 27, 28]),
  film("Ghostbusters", [27, 28, 29]),
];

const now = new Date("2026-07-18T12:00:00Z");
for (const a of buildApolloAnnouncements(films, now)) {
  const f = (s: number) => new Date(s * 1000).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
  console.log(`[${f(a.startTime)} to ${f(a.endTime)}] ${a.title}`);
  console.log(`    ${a.description}`);
}
