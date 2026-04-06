"use client";

import { useState } from "react";
import { Code, Eye } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { ToggleSwitch } from "@/components/toggle-switch";

export function MarkdownPreview({
  content,
  name,
}: {
  content: string | null;
  name: string;
}) {
  const [mode, setMode] = useState<"rendered" | "source">("rendered");
  const text = content ?? "";
  const lines = text.split("\n");
  const gutterWidth = `${String(lines.length).length + 1}ch`;

  if (!text) {
    return (
      <div className="rounded-lg border bg-muted/30 flex items-center justify-center min-h-[40vh]">
        <p className="text-sm text-muted-foreground">Empty file</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden flex flex-col">
      {/* Toolbar — mirrors pdf-viewer style */}

      <div
        className={cn(
          "rounded-t-lg flex items-center justify-between px-3 py-1.5",
          "border-b bg-background/95 backdrop-blur-sm",
          "supports-[backdrop-filter]:bg-background/80",
          "shrink-0 z-10",
        )}
      >
        <span className="text-xs text-muted-foreground font-mono truncate">
          {name}
        </span>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground tabular-nums">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
          <ToggleSwitch
            onChange={(v) => setMode(v)}
            options={[
              {
                icon: Eye,
                value: "rendered",
              },
              {
                icon: Code,
                value: "source",
              },
            ]}
            value={mode}
          />
        </div>
      </div>

      {/* Content */}
      <div className="overflow-auto max-h-full">
        {mode === "rendered" ? (
          <div className="p-6 md:px-10 md:py-8 prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-code:before:content-none prose-code:after:content-none prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-img:rounded-lg">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : (
          <pre className="text-sm font-mono leading-6">
            {lines.map((line, i) => (
              <div key={i} className="flex hover:bg-muted/30 transition-colors">
                <span
                  className="text-muted-foreground/40 select-none text-right px-3 shrink-0 border-r border-border/50"
                  style={{ minWidth: gutterWidth }}
                >
                  {i + 1}
                </span>
                <span className="px-4 whitespace-pre-wrap break-all flex-1">
                  {line || " "}
                </span>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
