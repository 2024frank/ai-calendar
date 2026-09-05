import type { ImgHTMLAttributes } from "react";

export default function PreviewImage({ priority: _priority, alt, ...props }: ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) {
  // The preview tests layout and controls; Next's image optimizer is out of scope.
  void _priority;
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={alt ?? ""} />;
}
