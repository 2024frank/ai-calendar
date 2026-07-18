import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { communities, sources } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getEventScoped } from "@/lib/data";
import { EventStatus } from "@/components/bits";
import { EventReview } from "./EventReview";

export const dynamic = "force-dynamic";

export default async function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireUser();
  const ev = await getEventScoped(s, Number(id));
  if (!ev) notFound();

  const [source] = ev.sourceId
    ? await db.select().from(sources).where(eq(sources.id, ev.sourceId)).limit(1)
    : [null];
  const [community] = await db
    .select()
    .from(communities)
    .where(eq(communities.id, ev.communityId))
    .limit(1);

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 1200 }}>
      <div>
        <Link href="/review" className="muted" style={{ fontSize: 13 }}>
          ← Pending events
        </Link>
        <div className="spread" style={{ marginTop: 4 }}>
          <div className="page-title">{ev.title || "(untitled)"}</div>
          <EventStatus status={ev.status} />
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          Edit anything that is wrong, then approve. Rejecting teaches the agent what to avoid.
        </div>
      </div>

      <EventReview
        event={{
          id: ev.id,
          status: ev.status,
          eventType: ev.eventType,
          title: ev.title,
          description: ev.description,
          extendedDescription: ev.extendedDescription,
          sessions: (ev.sessions ?? []) as { startTime: number; endTime: number }[],
          locationType: ev.locationType,
          location: ev.location,
          placeName: ev.placeName,
          roomNum: ev.roomNum,
          geoScope: ev.geoScope,
          urlLink: ev.urlLink,
          displayType: ev.displayType,
          screensIds: (ev.screensIds ?? []) as number[],
          postTypeIds: (ev.postTypeIds ?? []) as number[],
          sponsors: (ev.sponsors ?? []) as string[],
          buttons: (ev.buttons ?? []) as { title: string; link: string }[],
          website: ev.website,
          registrationUrl: ev.registrationUrl,
          imageCdnUrl: ev.imageCdnUrl,
          hasImageData: !!ev.imageData,
          contactEmail: ev.contactEmail,
          phone: ev.phone,
          calendarSourceName: ev.calendarSourceName,
          calendarSourceUrl: ev.calendarSourceUrl,
          ingestedPostUrl: ev.ingestedPostUrl,
          fieldNotes: (ev.fieldNotes ?? null) as Record<string, string> | null,
          rejectionReason: ev.rejectionReason,
        }}
        sourceName={source?.name ?? "Unknown source"}
        publishEmail={process.env.PUBLISH_EMAIL ?? ""}
        timezone={community?.timezone ?? "America/New_York"}
      />
    </div>
  );
}
