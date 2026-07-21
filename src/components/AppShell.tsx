"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { IconButton } from "@/components/ui";

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        window.setTimeout(() => (document.querySelector('[aria-controls="app-sidebar"]') as HTMLElement | null)?.focus(), 0);
      }
    };
    document.body.classList.add("nav-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("nav-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open && mobile) window.setTimeout(() => (document.querySelector("#app-sidebar a") as HTMLElement | null)?.focus(), 0);
  }, [mobile, open]);

  const accessibleSidebar = isValidElement(sidebar)
    ? cloneElement(sidebar as ReactElement<{ inert?: boolean; "aria-hidden"?: boolean }>, {
        inert: mobile && !open,
        "aria-hidden": mobile && !open ? true : undefined,
      })
    : sidebar;

  return (
    <div className="shell" data-nav-open={open ? "true" : "false"}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="mobile-header">
        <div className="mobile-brand" aria-label="CommunityHub AI Calendar">
          <Image src="/brand/communityhub-mark.png" alt="" width={32} height={32} priority />
          <span><strong>CommunityHub</strong><small>AI Calendar</small></span>
        </div>
        <IconButton
          label={open ? "Close navigation" : "Open navigation"}
          icon={open ? "close" : "menu"}
          variant="ghost"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="app-sidebar"
        />
      </header>
      <button className="nav-scrim" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} />
      {accessibleSidebar}
      <main className="main" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
