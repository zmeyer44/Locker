'use client';
import { Template } from '../template';
import { Button } from '@/components/button';
import type { ComponentProps } from 'react';
import { useModal } from '../provider';
type AnnouncementModalProps = {
  title: string;
  description?: string;
  children?: React.ReactNode;
  onConfirm?: () => void;
  buttonProps?: ComponentProps<typeof Button>;
  secondaryButtonProps?: ComponentProps<typeof Button>;
};
export function AnnouncementModal({
  title,
  description,
  children,
  onConfirm,
  buttonProps = {
    text: 'Ok',
  },
  secondaryButtonProps = {
    text: 'Cancel',
  },
}: AnnouncementModalProps) {
  const modal = useModal();
  return (
    <Template
      title={title}
      footer={
        <div className="flex flex-1 items-center gap-3">
          {!!secondaryButtonProps && (
            <Button
              onClick={() => {
                modal.hide();
              }}
              variant="secondary"
              {...secondaryButtonProps}
            />
          )}
          <Button
            onClick={() => {
              if (onConfirm) {
                onConfirm();
              }
              modal.hide();
            }}
            className="flex-1"
            {...buttonProps}
          />
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
