"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
export type SupportPhoto = { id: string; width: number; height: number };

export function PhotoGallery({
  photos,
  caseId,
  bearer,
  basePath,
}: {
  photos: SupportPhoto[];
  caseId: string;
  bearer?: string;
  basePath?: string;
}) {
  const [images, setImages] = useState<{ id: string; url: string }[]>([]);
  const [error, setError] = useState("");
  const photoIds = photos.map((photo) => photo.id).join(",");
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    setImages([]);
    setError("");
    async function load() {
      try {
        const loaded = await Promise.all(
          (photoIds ? photoIds.split(",") : []).map(async (photoId) => {
            const path = basePath
              ? `${basePath}/${photoId}`
              : bearer
                ? `/api/consulting/admin/photos/${photoId}`
                : `/api/consulting/tickets/${caseId}/photos/${photoId}`;
            const response = await fetch(path, {
              headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok)
              throw new Error(
                "Some equipment photos could not be loaded. Refresh to try again.",
              );
            const blob = await response.blob();
            if (controller.signal.aborted) throw new Error("Canceled");
            const url = URL.createObjectURL(blob);
            urls.push(url);
            return { id: photoId, url };
          }),
        );
        if (!controller.signal.aborted) setImages(loaded);
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      }
    }
    void load();
    return () => {
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photoIds, caseId, bearer, basePath]);
  if (!photos.length) return null;
  return (
    <section className="ticket-photos">
      <h3>Equipment photos</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="photo-gallery">
        {images.map((image, index) => (
          <a
            key={image.id}
            href={image.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open equipment photo ${index + 1}`}
          >
            <Image
              unoptimized
              width={400}
              height={240}
              src={image.url}
              alt={`Equipment photo ${index + 1}`}
            />
          </a>
        ))}
      </div>
    </section>
  );
}
