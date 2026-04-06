import { cn } from "@/lib/utils";

export function TagBadge({
  name,
  color,
  className,
}: {
  name: string;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block max-w-full rounded-full px-2 py-0.5 text-xs font-medium leading-5 truncate",
        !color && "bg-muted text-muted-foreground",
        className,
      )}
      style={
        color ? { backgroundColor: `${color}20`, color } : undefined
      }
    >
      {name}
    </span>
  );
}
