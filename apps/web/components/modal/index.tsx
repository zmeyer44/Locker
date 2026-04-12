'use client';

import { useIsMobile } from '@/hooks/use-mobile';
import { AnimatePresence, motion } from 'motion/react';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import Leaflet from './leaflet';
import { cn } from '@/lib/utils';
import type { ModalOptions } from './provider';

export { useModal } from './provider';

export default function Modal({
  children,
  showModal,
  setShowModal,
  options,
}: {
  children: React.ReactNode;
  showModal: boolean;
  setShowModal: Dispatch<SetStateAction<boolean>>;
  options?: ModalOptions;
}) {
  const desktopModalRef = useRef(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !options?.notDismissible) {
        setShowModal(false);
      }
    },
    [setShowModal, options?.notDismissible],
  );

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  const isMobile = useIsMobile();

  return (
    <AnimatePresence>
      {showModal && (
        <>
          {isMobile && !options?.noLeaflet && (
            <Leaflet setShow={setShowModal}>{children}</Leaflet>
          )}
          {(!isMobile || options?.noLeaflet) && (
            <>
              <motion.div
                ref={desktopModalRef}
                key="desktop-modal"
                className={cn(
                  'fixed inset-0 isolate z-[70] hidden min-h-screen items-center justify-center md:flex',
                  options?.noLeaflet && 'flex',
                )}
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                onMouseDown={(e) => {
                  if (
                    desktopModalRef.current === e.target &&
                    !options?.notDismissible
                  ) {
                    setShowModal(false);
                  }
                }}
              >
                {children}
              </motion.div>

              <motion.div
                key="desktop-backdrop"
                className={cn(
                  'fixed inset-0 z-[60] bg-neutral-900/10 backdrop-blur-sm',
                  options?.backdropClassName,
                )}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  if (!options?.notDismissible) {
                    setShowModal(false);
                  }
                }}
              />
            </>
          )}
        </>
      )}
    </AnimatePresence>
  );
}
