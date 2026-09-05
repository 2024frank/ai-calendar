import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => "/dashboard");
}

export function useRouter() {
  return {
    push(href: string) {
      window.history.pushState(null, "", href);
      window.dispatchEvent(new PopStateEvent("popstate"));
    },
    refresh() { window.dispatchEvent(new Event("fixture:refresh")); },
  };
}
