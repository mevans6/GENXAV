"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";

export type SelectedPhoto = {
  key: string;
  name: string;
  file: File;
  preview: string;
  uploadedId?: string;
};

async function prepare(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Choose JPEG, PNG, or WebP photos. Export HEIC photos as JPEG first.",
    );
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose photos smaller than 20 MB each.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "This photo could not be read. Try another JPEG, PNG, or WebP file.",
    );
  }
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Photo preparation is unavailable in this browser.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Photo preparation failed.")),
        "image/jpeg",
        0.82,
      ),
    );
    if (blob.size > 3 * 1024 * 1024)
      throw new Error("This photo is too large. Choose a smaller image.");
    return new File([blob], "equipment-photo.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

export function PhotoUpload({
  photos,
  onChange,
  onBusyChange,
  disabled,
}: {
  photos: SelectedPhoto[];
  onChange: (photos: SelectedPhoto[]) => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const current = useRef(photos);
  useEffect(() => {
    current.current = photos;
  }, [photos]);
  useEffect(
    () => () => current.current.forEach((p) => URL.revokeObjectURL(p.preview)),
    [],
  );
  async function select(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    setError("");
    if (photos.length + files.length > 6) {
      setError("You can add up to six photos.");
      return;
    }
    setPreparing(true);
    onBusyChange(true);
    const added: SelectedPhoto[] = [];
    try {
      for (const original of files) {
        const file = await prepare(original);
        added.push({
          key: crypto.randomUUID(),
          name: original.name,
          file,
          preview: URL.createObjectURL(file),
        });
      }
      onChange([...photos, ...added]);
    } catch (error) {
      added.forEach((p) => URL.revokeObjectURL(p.preview));
      setError((error as Error).message);
    } finally {
      setPreparing(false);
      onBusyChange(false);
    }
  }
  return (
    <div className="form-field photo-field">
      <label htmlFor="equipment-photos">
        <Camera size={17} aria-hidden="true" /> Equipment photos{" "}
        <span>(optional)</span>
      </label>
      <p id="photo-help">
        Add up to six photos of equipment labels, screens, or safely accessible
        connections. JPEG, PNG, or WebP, up to 20 MB each. Photos stay private.
      </p>
      <input
        id="equipment-photos"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={select}
        disabled={disabled || preparing || photos.length >= 6}
        aria-describedby="photo-help photo-error"
      />
      {preparing && <p role="status">Preparing your photos…</p>}
      {photos.length > 0 && (
        <ul className="photo-previews">
          {photos.map((photo, index) => (
            <li key={photo.key}>
              <Image
                src={photo.preview}
                width={160}
                height={110}
                unoptimized
                alt={`Selected equipment photo ${index + 1}`}
              />
              <span title={photo.name}>{photo.name}</span>
              <button
                type="button"
                disabled={disabled || preparing}
                aria-label={`Remove photo ${index + 1}`}
                onClick={() => {
                  URL.revokeObjectURL(photo.preview);
                  onChange(photos.filter((p) => p.key !== photo.key));
                }}
              >
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="error" id="photo-error" role={error ? "alert" : undefined}>
        {error}
      </p>
    </div>
  );
}

export { prepare as preparePhoto };
