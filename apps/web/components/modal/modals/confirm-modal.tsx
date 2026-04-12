import { Template } from '../template';
import { Button } from '@/components/button';
import type { ComponentProps } from 'react';
import { useModal } from '../provider';
type ConfirmModalProps = {
  title: string;
  description?: string;
  children?: React.ReactNode;
  onConfirm: () => void;
  buttonProps?: ComponentProps<typeof Button>;
};
export function ConfirmModal({
  title,
  description,
  children,
  onConfirm,
  buttonProps = {},
}: ConfirmModalProps) {
  const modal = useModal();
  return (
    <Template
      title={title}
      footer={
        <div className="flex flex-1 items-center justify-between gap-x-3">
          <Button onClick={() => modal?.hide()} variant={'outline'} text="Cancel" />
          <Button onClick={onConfirm} text="Confirm" {...buttonProps} />
        </div>
      }
    >
      {children ? (
        children
      ) : (
        <div className="center relative w-full">
          <p className="text-muted-foreground">{description}</p>
        </div>
      )}
    </Template>
  );
}
