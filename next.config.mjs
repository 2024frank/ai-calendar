/** @type {import('next').NextConfig} */
const scriptPolicy =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const nextConfig = {
  serverExternalPackages: ["mysql2", "sharp"],
  // sharp's libvips shared library is loaded with dlopen, which Next's file
  // tracer cannot see, so deployments shipped the JS half of sharp without the
  // native half and every importing route crashed on load (ERR_DLOPEN_FAILED,
  // libvips-cpp.so missing). Force the whole @img tree into every function.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@img/**"],
  },
  async headers() {
    const securityHeaders = [
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "base-uri 'self'",
          "connect-src 'self'",
          "font-src 'self' data:",
          "form-action 'self'",
          "frame-ancestors 'none'",
          "img-src 'self' data: https:",
          "object-src 'none'",
          scriptPolicy,
          "style-src 'self' 'unsafe-inline'",
          "upgrade-insecure-requests",
        ].join("; "),
      },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Strict-Transport-Security",
        value: "max-age=31536000; includeSubDomains",
      },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
