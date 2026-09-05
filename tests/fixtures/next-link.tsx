import type { AnchorHTMLAttributes } from "react";
import { useRouter } from "./next-navigation";

export default function PreviewLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const router = useRouter();
  return <a {...props} onClick={(event) => {
    props.onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !props.href?.startsWith("/")) return;
    event.preventDefault();
    router.push(props.href);
  }} />;
}
