"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { IconType } from "./icon";

type ToggleSwitchProps<T extends string> = {
  options: {
    value: T;
    icon: IconType;
  }[];
  value: T;
  onChange: (selectedValue: T) => void;
};

export function ToggleSwitch<T extends string>({
  options,
  onChange,
  value,
}: ToggleSwitchProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState({ left: 0, width: 0 });
  const [ready, setReady] = useState(false);

  const activeIndex = options.findIndex((option) => option.value === value);

  const measure = useCallback(() => {
    if (!containerRef.current || activeIndex === -1) return;
    const buttons =
      containerRef.current.querySelectorAll<HTMLElement>("[data-toggle-btn]");
    const active = buttons[activeIndex];
    if (active) {
      setHighlight({ left: active.offsetLeft, width: active.offsetWidth });
      setReady(true);
    }
  }, [activeIndex]);

  useEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center rounded-full border bg-muted/50 p-0.5"
    >
      {ready && activeIndex !== -1 && highlight.width > 0 && (
        <motion.div
          className="absolute size-7 rounded-full bg-background shadow-sm"
          initial={false}
          animate={{ left: highlight.left, width: highlight.width }}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}

      {options.map((option) => (
        <button
          key={option.value}
          data-toggle-btn
          onClick={() => onChange(option.value)}
          className={cn(
            "relative z-10 flex items-center justify-center size-7 rounded-full transition-colors",
            option.value === value
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <option.icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
