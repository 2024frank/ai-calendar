import type { Metadata, Viewport } from "next";
import { Comfortaa, Lato } from "next/font/google";
import "./globals.css";

// Self-hosted by Next at build time, so the page makes no external font request.
// Lato body + Comfortaa headings match v1.communityhub.cloud.
const sans = Lato({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "700", "900"],
  variable: "--font-sans",
});

const display = Comfortaa({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: {
    default: "AI Calendar",
    template: "%s · AI Calendar",
  },
  description: "AI-powered community event calendar",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f5" },
    { media: "(prefers-color-scheme: dark)", color: "#161d24" },
  ],
};

const themeScript = `(() => { try { const saved = localStorage.getItem('ai-calendar-theme'); const theme = saved === 'light' || saved === 'dark' ? saved : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; } catch {} })();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
