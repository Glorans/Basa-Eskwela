import type { CSSProperties } from "react";

interface ImagePlaceholderProps {
  /** Real image URL/import. Leave "" to render a placeholder box instead. */
  src: string;
  /** Describes the image; shown as the placeholder's label. */
  alt: string;
  className?: string;
  width?: number | string;
  height?: number | string;
}

/**
 * Renders `src` as a normal <img> once you've pasted a real link into
 * src/assets/basaImages.ts. Until then, it shows a small dashed box labeled
 * with `alt` so the layout stays intact and it's obvious what to fill in.
 */
export default function ImagePlaceholder({ src, alt, className, width, height }: ImagePlaceholderProps) {
  const style: CSSProperties = { width, height };

  if (!src) {
    return (
      <div className={`img-placeholder ${className ?? ""}`.trim()} style={style} role="img" aria-label={alt} title={alt}>
        {alt}
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} style={style} />;
}
