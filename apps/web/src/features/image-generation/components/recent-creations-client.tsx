"use client";

import { useState } from "react";
import { ImageCard } from "@/features/image-generation/components/image-card";
import {
  ImageLightbox,
  type LightboxGeneration,
} from "@/features/image-generation/components/image-lightbox";

export interface RecentCreation {
  id: string;
  prompt: string;
  revisedPrompt: string | null;
  model: string;
  size: string;
  creditsConsumed: number;
  status: "pending" | "completed" | "failed";
  createdAt: string;
  storageKey: string | null;
  storageBucket: string | null;
  imageUrl: string | null;
}

export function RecentCreationsClient({
  initialGenerations,
}: {
  initialGenerations: RecentCreation[];
}) {
  const [items, setItems] = useState<RecentCreation[]>(initialGenerations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <ImageCard
            key={item.id}
            id={item.id}
            prompt={item.prompt}
            imageUrl={item.imageUrl}
            model={item.model}
            size={item.size}
            creditsConsumed={item.creditsConsumed}
            createdAt={item.createdAt}
            status={item.status}
            onClick={() => setSelectedId(item.id)}
          />
        ))}
      </div>

      {selected && (
        <ImageLightbox
          generation={selected as LightboxGeneration}
          imageUrl={selected.imageUrl}
          open={selectedId !== null}
          onClose={() => setSelectedId(null)}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}
