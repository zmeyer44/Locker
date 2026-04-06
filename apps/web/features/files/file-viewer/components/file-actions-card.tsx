import type { ComponentProps, ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type ActionType =
  | {
      type: "separator";
      props?: ComponentProps<typeof Separator>;
    }
  | {
      type: "button";
      props: ButtonProps;
    }
  | {
      type: "custom";
      render: ReactNode;
    };

type FileActionsCardProps = {
  actions: (ActionType | null | false)[];
};
export function FileActionsCard({ actions }: FileActionsCardProps) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-1">
      {actions.map((action, i) => {
        if (!action) return null;
        if (action.type === "separator") {
          return (
            <Separator
              key={i}
              {...action.props}
              className={cn("!my-2", action.props?.className)}
            />
          );
        }
        if (action.type === "button") {
          return (
            <Button
              key={i}
              variant="ghost"
              className="w-full justify-start"
              size="sm"
              {...action.props}
            />
          );
        }
        return <div key={i}>{action.render}</div>;
      })}
    </div>
  );
}
