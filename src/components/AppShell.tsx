"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { cloneElement, isValidElement, useEffect, useState, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { IconButton } from "@/components/ui";

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const [mobile, setMobile] = useState(false);
  const drawerOpen = mobile && open;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setOpenPath(null);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const sidebarElement = document.getElementById("app-sidebar");
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(sidebarElement?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex="0"]',
    ) ?? []);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpenPath(null);
      } else if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (!first || !last) {
          event.preventDefault();
          sidebarElement?.focus();
        } else if (event.shiftKey && (document.activeElement === first || !sidebarElement?.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !sidebarElement?.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const focusTimer = window.setTimeout(() => (focusable()[0] ?? sidebarElement)?.focus(), 0);
    document.body.classList.add("nav-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.classList.remove("nav-open");
      window.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected && window.matchMedia("(max-width: 900px)").matches) previousFocus.focus();
      });
    };
  }, [drawerOpen]);

  const accessibleSidebar = isValidElement(sidebar)
    ? cloneElement(sidebar as ReactElement<HTMLAttributes<HTMLElement>>, {
        inert: mobile && !open,
        "aria-hidden": mobile && !open ? true : undefined,
        role: drawerOpen ? "dialog" : undefined,
        "aria-modal": drawerOpen ? true : undefined,
        tabIndex: -1,
        onClick: (event) => {
          if ((event.target as HTMLElement).closest("a[href]")) setOpenPath(null);
        },
      }, <>
        <div className="side__drawer-close"><IconButton label="Close navigation" icon="close" variant="ghost" onClick={() => setOpenPath(null)} /></div>
        {(sidebar as ReactElement<{ children: ReactNode }>).props.children}
      </>)
    : sidebar;

  return (
    <div className="shell" data-nav-open={open ? "true" : "false"}>
      <a className="skip-link" href="#main-content" inert={drawerOpen}>Skip to main content</a>
      <header className="mobile-header" inert={drawerOpen}>
        <div className="mobile-brand" aria-label="CommunityHub AI Calendar">
          <Image src="/brand/communityhub-mark.png" alt="" width={32} height={32} priority />
          <span><strong>CommunityHub</strong><small>AI Calendar</small></span>
        </div>
        <IconButton
          label={open ? "Close navigation" : "Open navigation"}
          icon={open ? "close" : "menu"}
          variant="ghost"
          onClick={() => setOpenPath(open ? null : pathname)}
          aria-expanded={open}
          aria-controls="app-sidebar"
        />
      </header>
      <button className="nav-scrim" type="button" tabIndex={-1} aria-hidden="true" onClick={() => setOpenPath(null)} />
      {accessibleSidebar}
      <main className="main" id="main-content" tabIndex={-1} inert={drawerOpen}>{children}</main>
    </div>
  );
}
