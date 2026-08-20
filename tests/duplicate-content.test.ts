import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contentMatches, imageIdentity } from "../src/lib/contract";

/**
 * The agent is the duplicate judge. These cover the server's safety net, which
 * exists only to catch what the agent missed, and above all must not fuse
 * events that merely look alike.
 */

const VENUE = "67 North Main Street, Oberlin, OH 44074";
const MAR = [1804208400, 1804294800, 1804381200];

describe("one picture, several size words", () => {
  it("treats Localist size variants as the same picture", () => {
    assert.equal(
      imageIdentity("https://localist-images.azureedge.net/photos/837055/huge/d124.jpg"),
      imageIdentity("https://localist-images.azureedge.net/photos/837055/card/d124.jpg"),
    );
  });

  it("keeps genuinely different pictures apart", () => {
    assert.notEqual(
      imageIdentity("https://x.test/photos/837055/huge/a.jpg"),
      imageIdentity("https://x.test/photos/999999/huge/a.jpg"),
    );
  });

  it("ignores a query string and a size suffix", () => {
    assert.equal(imageIdentity("https://x.test/a_1200x600.jpg?w=90"), imageIdentity("https://x.test/a.jpg"));
  });
});

describe("the two opera listings that both reached the queue", () => {
  const poppea = (image: string) => ({
    title: `Claudio Monteverdi's "L'incoronazione di Poppea"`,
    startTimes: MAR,
    location: VENUE,
    description: "Oberlin Opera Theater stages Monteverdi's L'incoronazione di Poppea.",
    imageUrl: image,
  });

  it("matches across the image size word", () => {
    const m = contentMatches(
      poppea("https://localist-images.azureedge.net/photos/837055/huge/d1.jpg"),
      poppea("https://localist-images.azureedge.net/photos/837055/card/d1.jpg"),
    );
    assert.equal(m.match, true, m.reason);
  });
});

describe("what must NEVER be fused", () => {
  // A Conservatory season reuses one promo photo across its whole series. 14
  // concerts share one image in the live queue; merging them would destroy them.
  const seasonImage = "https://localist-images.azureedge.net/photos/32891369040503/huge/c0.jpg";

  it("leaves different concerts sharing one season photo alone", () => {
    const m = contentMatches(
      { title: "Concert: Oberlin Jazz Ensemble", startTimes: [1800000000], location: VENUE,
        description: "The Jazz Ensemble performs works from the big band repertoire.", imageUrl: seasonImage },
      { title: "Arthur Dann Piano Competition", startTimes: [1800200000], location: VENUE,
        description: "Pianists compete for the Arthur Dann prize before a jury.", imageUrl: seasonImage },
    );
    assert.equal(m.match, false, `wrongly merged: ${m.reason}`);
  });

  it("leaves two different events at one venue on one day alone", () => {
    const m = contentMatches(
      { title: "Morning Yoga", startTimes: [1800000000], location: VENUE, description: "Gentle yoga to start the day, mats provided." },
      { title: "Evening Lecture", startTimes: [1800030000], location: VENUE, description: "A talk on nineteenth century printmaking." },
    );
    assert.equal(m.match, false, `wrongly merged: ${m.reason}`);
  });

  it("does not merge on a shared picture when the titles differ", () => {
    const m = contentMatches(
      { title: "Concert: Oberlin Sinfonietta", startTimes: [1800000000], location: VENUE,
        description: "The Sinfonietta plays Stravinsky and Ravel this evening.", imageUrl: seasonImage },
      { title: "The Danenberg Honors Recital, Part I", startTimes: [1800000000], location: VENUE,
        description: "Honors students perform solo repertoire chosen by audition.", imageUrl: seasonImage },
    );
    assert.equal(m.match, false, `wrongly merged: ${m.reason}`);
  });
});

describe("a retitled repost", () => {
  it("matches on a near-identical description at the same venue", () => {
    const body = "Oberlin Opera Theater stages Monteverdi's masterwork in a new production directed by the faculty.";
    const m = contentMatches(
      { title: "L'incoronazione di Poppea", startTimes: [1804208400], location: VENUE, description: body },
      { title: "Monteverdi Opera", startTimes: [1806000000], location: VENUE, description: body + " " },
    );
    assert.equal(m.match, true, m.reason);
  });

  it("still needs the venue to agree", () => {
    const body = "Oberlin Opera Theater stages Monteverdi's masterwork in a new production directed by the faculty.";
    const m = contentMatches(
      { title: "L'incoronazione di Poppea", startTimes: [1804208400], location: VENUE, description: body },
      { title: "Monteverdi Opera", startTimes: [1806000000], location: "Elsewhere, Cleveland, OH", description: body },
    );
    assert.equal(m.match, false, `wrongly merged: ${m.reason}`);
  });
});
