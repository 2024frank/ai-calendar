import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Calendar",
  description: "AI-powered community event calendar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
