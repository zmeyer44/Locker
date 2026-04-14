"use client";

import { useState } from "react";
import { Template } from "../template";
import { Button } from "@/components/button";
import { useModal } from "../provider";
import { cn } from "@/lib/utils";

export type ConflictStrategyValue = "skip" | "keep_newer" | "overwrite";

type SyncOperationModalProps = {
  operation: "pull" | "push";
  storeName?: string;
  onConfirm: (strategy: ConflictStrategyValue) => void;
};

const strategies: {
  value: ConflictStrategyValue;
  label: string;
  description: string;
}[] = [
  {
    value: "skip",
    label: "Skip conflicts",
    description: "Files that already exist will be left unchanged",
  },
  {
    value: "keep_newer",
    label: "Keep newer",
    description: "The version with the most recent modification date wins",
  },
  {
    value: "overwrite",
    label: "Overwrite all",
    description: "All files will be replaced regardless of timestamps",
  },
];

export function SyncOperationModal({
  operation,
  storeName,
  onConfirm,
}: SyncOperationModalProps) {
  const modal = useModal();
  const [strategy, setStrategy] = useState<ConflictStrategyValue>("skip");

  const title =
    operation === "pull"
      ? `Pull from ${storeName}`
      : storeName
        ? `Push to ${storeName}`
        : "Push to all stores";

  const description =
    operation === "pull"
      ? "Import files from this store into Locker."
      : storeName
        ? "Send Locker files to this store."
        : "Send Locker files to all connected stores.";

  return (
    <Template
      title={title}
      description={description}
      footer={
        <div className="flex flex-1 items-center justify-between gap-x-3">
          <Button
            onClick={() => modal?.hide()}
            variant="outline"
            text="Cancel"
          />
          <Button
            onClick={() => {
              modal?.hide();
              onConfirm(strategy);
            }}
            text={operation === "pull" ? "Pull" : "Push"}
          />
        </div>
      }
    >
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          How should conflicts be handled?
        </p>
        {strategies.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => setStrategy(s.value)}
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
              strategy === s.value
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "border-border hover:border-foreground/20",
            )}
          >
            <span className="font-medium">{s.label}</span>
            <span className="text-xs text-muted-foreground">
              {s.description}
            </span>
          </button>
        ))}
      </div>
    </Template>
  );
}
