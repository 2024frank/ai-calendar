/** Test-only transport. Production publicUrl/SSRF policy is never modified. */
export function syntheticPublicationTransport(receiverBaseUrl: string) {
  const receiver = new URL(receiverBaseUrl);
  if (receiver.protocol !== "http:" || receiver.hostname !== "127.0.0.1" || !receiver.port ||
    receiver.pathname !== "/" || receiver.username || receiver.password || receiver.search || receiver.hash) {
    throw new Error("The synthetic receiver must be an explicitly bound loopback server.");
  }
  const validate = (raw: string) => {
    const url = new URL(raw);
    if (url.origin !== "https://synthetic-publisher.example.test" || url.username || url.password || url.search || url.hash ||
      !/^\/api\/legacy\/calendar\/post\/(?:[1-9]\d*\/)?submit$/.test(url.pathname)) {
      throw new Error("Only the exact synthetic publication fixture destination is permitted.");
    }
    return url;
  };
  return {
    assertPublicHttpUrl: async (raw: string) => { validate(raw); },
    fetchPinnedPublicUrl: async (raw: string, init: RequestInit) => {
      const url = validate(raw);
      const method = url.pathname === "/api/legacy/calendar/post/submit" ? "POST" : "PATCH";
      if (init.method !== method) throw new Error("Unexpected synthetic publication method.");
      // No DNS lookup for the fixture name and no redirects or fallback to a
      // real destination. Every byte goes to the already-bound loopback server.
      const response = await fetch(new URL(url.pathname, receiver), {
        ...init, redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(5000), ...(init.signal ? [init.signal] : [])]),
      });
      return { response, close: async () => { if (response.body && !response.bodyUsed) await response.body.cancel(); } };
    },
  };
}
