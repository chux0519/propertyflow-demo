// next/image loader. Vercel image optimisation is not used: placeholder photos come
// from Lorem Picsum, which renders any size on request, and processed images are
// served as-is from R2.
export default function imageLoader({ src, width }: { src: string; width: number }): string {
  const picsum = /^https:\/\/picsum\.photos\/(id|seed)\/([\w-]+)\/\d+\/\d+\.jpg$/.exec(src);
  if (picsum) return `https://picsum.photos/${picsum[1]}/${picsum[2]}/${width}/${Math.round((width * 3) / 4)}.jpg`;
  return src;
}
