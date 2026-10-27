import Image from "next/image";
import type { ImageRef } from "@/lib/db/catalog";

export function PropertyImage({
  image, alt, sizes, priority = false, noPhoto,
}: { image: ImageRef | null; alt: string; sizes: string; priority?: boolean; noPhoto: string }) {
  if (!image) {
    return (
      <div className="flex aspect-[4/3] w-full items-center justify-center bg-sand-200 text-sm text-ink-500">{noPhoto}</div>
    );
  }
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden bg-sand-200">
      <Image src={image.src} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
    </div>
  );
}
