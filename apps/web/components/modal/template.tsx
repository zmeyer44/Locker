import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

type TemplateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};
export function Template({
  title,
  description,
  children,
  footer,
  className,
  ...props
}: TemplateProps) {
  return (
    <div
      className={cn(
        "isolate w-full bg-background rounded-lg md:max-w-md md:border md:shadow",
        className,
      )}
      {...props}
    >
      <div className="relative flex flex-col space-y-4 p-6  max-h-[80vh] overflow-y-auto">
        {!!title && (
          <div className="">
            <h2 className="title font-semibold text-xl">{title}</h2>
            {!!description && (
              <p className="mt-1 text-muted-foreground text-sm leading-tight">
                {description}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
      {!!footer && <FormFooter>{footer}</FormFooter>}
    </div>
  );
}

export function FormFooter({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center justify-end border-border border-t bg-muted/40 p-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
