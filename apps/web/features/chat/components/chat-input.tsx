"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ArrowUp, Square, ChevronDown, Plus, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const AVAILABLE_MODELS = [
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    provider: "Anthropic",
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    provider: "Anthropic",
  },
  { id: "openai/gpt-5.4", label: "GPT-5.4", provider: "OpenAI" },
  {
    id: "google/gemini-3-flash",
    label: "Gemini 3 Flash",
    provider: "Google",
  },
  {
    id: "xai/grok-4.1-fast-reasoning",
    label: "Grok 4.1",
    provider: "xAI",
  },
] as const;

export type ModelId = (typeof AVAILABLE_MODELS)[number]["id"];

export interface ChatAttachment {
  file: File;
  preview?: string;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  model: ModelId;
  onModelChange: (model: ModelId) => void;
  disabled?: boolean;
  isSending?: boolean;
  placeholder?: string;
  attachments?: ChatAttachment[];
  onAttach?: (files: FileList) => void;
  onRemoveAttachment?: (index: number) => void;
  className?: string;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  model,
  onModelChange,
  disabled = false,
  isSending = false,
  placeholder = "Reply...",
  attachments = [],
  onAttach,
  onRemoveAttachment,
  className,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const canSubmit =
    (value.trim().length > 0 || attachments.length > 0) && !disabled;

  useEffect(() => {
    if (!disabled) textareaRef.current?.focus();
  }, [disabled]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && canSubmit && !isSending) {
      e.preventDefault();
      onSubmit();
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit && !isSending) {
      onSubmit();
      if (textareaRef.current) textareaRef.current.style.height = "auto";
    }
  };

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && onAttach) {
        onAttach(e.target.files);
        e.target.value = "";
      }
    },
    [onAttach],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer.files.length > 0 && onAttach) {
        onAttach(e.dataTransfer.files);
      }
    },
    [onAttach],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const selectedModel =
    AVAILABLE_MODELS.find((m) => m.id === model) ?? AVAILABLE_MODELS[0];

  return (
    <div className={cn("px-4 pb-4 pt-2", className)}>
      <form
        onSubmit={handleSubmit}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="mx-auto max-w-3xl"
      >
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((att, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-sm"
              >
                {att.preview ? (
                  <img
                    src={att.preview}
                    alt={att.file.name}
                    className="size-8 rounded object-cover"
                  />
                ) : (
                  <Paperclip className="size-3.5 text-muted-foreground" />
                )}
                <span className="max-w-[120px] truncate text-foreground">
                  {att.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment?.(idx)}
                  className="ml-0.5 flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input container */}
        <div
          className={cn(
            "rounded-2xl border bg-background shadow-sm transition-all",
            isFocused ? "border-border shadow-md" : "border-border/60",
            disabled && "opacity-50",
          )}
        >
          {/* Textarea row */}
          <div className="flex items-end gap-1 px-4 py-3">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              style={{ boxShadow: "none" }}
            />

            {/* Send indicator — small dot when ready, square when streaming */}
            <div className="flex items-center pb-0.5">
              {isSending ? (
                <button
                  type="button"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
                  title="Stop generating"
                >
                  <Square className="size-3" fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full transition-all",
                    canSubmit
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
                      : "text-muted-foreground/30",
                  )}
                >
                  {canSubmit ? (
                    <ArrowUp className="size-3.5" />
                  ) : (
                    <div className="size-2 rounded-full bg-primary" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between border-t border-border/30 px-3 py-1.5">
            {/* Left: attach */}
            <div className="flex items-center gap-0.5">
              {onAttach && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled}
                    className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    title="Attach files"
                  >
                    <Plus className="size-4" />
                  </button>
                </>
              )}
            </div>

            {/* Right: model selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>{selectedModel.label}</span>
                  <ChevronDown className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {AVAILABLE_MODELS.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onSelect={() => onModelChange(m.id)}
                    className={cn(m.id === model && "bg-accent")}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm">{m.label}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {m.provider}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </form>
    </div>
  );
}
