"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui";

/**
 * v1.communityhub.cloud pattern: one black top bar with the wordmark on the
 * left and horizontal navigation, collapsing to a menu button on narrow
 * screens. The menu content exists once in the DOM; CSS moves it between
 * the bar (wide) and a dropdown panel (narrow).
 */
export function AppShell({ brand, nav, tools, children }: { brand: ReactNode; nav: ReactNode; tools: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const [mobile, setMobile] = useState(false);
  const menuOpen = mobile && open;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1080px)");
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setOpenPath(null);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const menu = document.getElementById("app-menu");
    const previousFocus = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenPath(null);
      }
    };
    const focusTimer = window.setTimeout(() => {
      menu?.querySelector<HTMLElement>('a[href], button:not([disabled]), select:not([disabled])')?.focus();
    }, 0);
    document.body.classList.add("nav-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.classList.remove("nav-open");
      window.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected && window.matchMedia("(max-width: 1080px)").matches) previousFocus.focus();
      });
    };
  }, [menuOpen]);

  return (
    <div className="shell" data-nav-open={open ? "true" : "false"}>
      <a className="skip-link" href="#main-content" inert={menuOpen}>Skip to main content</a>
      <header className="topbar">
        {brand}
        <div
          className="topbar__menu"
          id="app-menu"
          inert={mobile && !open}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a[href]")) setOpenPath(null);
          }}
        >
          {nav}
          {tools}
        </div>
        <span className="topbar__toggle">
          <IconButton
            label={open ? "Close navigation" : "Open navigation"}
            icon={open ? "close" : "menu"}
            variant="ghost"
            onClick={() => setOpenPath(open ? null : pathname)}
            aria-expanded={open}
            aria-controls="app-menu"
          />
        </span>
      </header>
      <main className="main" id="main-content" tabIndex={-1} inert={menuOpen}>{children}</main>
      <footer className="app-footer" inert={menuOpen}>
        <span>© {new Date().getFullYear()} All rights reserved. CommunityHub.</span>
        <span className="app-footer__product">AI Calendar</span>
      </footer>
    </div>
  );
}
