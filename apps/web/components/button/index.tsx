import type React from "react";
import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import {
  Button as ButtonPrimitive,
  buttonVariants,
} from "@/components/ui/button";

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    text?: ReactNode | string;
    textWrapperClassName?: string;
    loading?: boolean;
    icon?: ReactNode;
    shortcut?: string;
    right?: ReactNode;
    disabledTooltip?: string | ReactNode;
    tooltip?: string | ReactNode;
    children?: never;
  };

export function Button({
  className,
  variant,
  size,
  text,
  textWrapperClassName,
  loading,
  icon,
  shortcut,
  disabledTooltip,
  tooltip,
  right,
  ...props
}: ButtonProps) {
  const button = (
    <button
      type={props.onClick ? "button" : "submit"}
      className={cn(
        "group flex items-center justify-center whitespace-nowrap",
        buttonVariants({ variant, size }),
        (props.disabled || loading) &&
          "opacity-50 cursor-not-allowed pointer-events-none",
        className,
      )}
      disabled={props.disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : icon ? icon : null}
      {text && (
        <span
          className={cn("min-w-0 truncate font-semibold", textWrapperClassName)}
        >
          {text}
        </span>
      )}
      {shortcut && (
        <kbd className="shrink-0 hidden border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 text-[10px] font-light text-neutral-400 md:inline-block">
          {shortcut}
        </kbd>
      )}
      {right}
    </button>
  );

  //   if (tooltip) {
  //     return <Tooltip content={tooltip}>{button}</Tooltip>;
  //   }

  //   if (props.disabled && disabledTooltip) {
  //     return (
  //       <Tooltip content={disabledTooltip}>
  //         <span className="cursor-not-allowed">{button}</span>
  //       </Tooltip>
  //     );
  //   }

  return button;
}
