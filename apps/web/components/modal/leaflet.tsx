'use client';

import {
  AnimatePresence,
  motion,
  useAnimation,
  type Transition,
} from 'motion/react';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
} from 'react';

export default function Leaflet({
  setShow,
  children,
}: {
  setShow: Dispatch<SetStateAction<boolean>>;
  children: ReactNode;
}) {
  const leafletRef = useRef<HTMLDivElement>(null);
  const controls = useAnimation();
  const transitionProps: Transition = {
    type: 'spring',
    stiffness: 500,
    damping: 30,
  };

  useEffect(() => {
    controls.start({
      y: 20,
      transition: transitionProps,
    });
  }, [controls]);

  async function handleDragEnd(
    _: unknown,
    info: { offset: { y: number }; velocity: { y: number } },
  ) {
    const offset = info.offset.y;
    const velocity = info.velocity.y;
    const height = leafletRef.current?.getBoundingClientRect().height || 0;
    if (offset > height / 2 || velocity > 800) {
      await controls.start({ y: '100%', transition: transitionProps });
      setShow(false);
    } else {
      controls.start({ y: 0, transition: transitionProps });
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        ref={leafletRef}
        key="leaflet"
        className="group fixed inset-x-0 bottom-0 z-[70] max-h-[90vh] w-screen cursor-grab bg-white active:cursor-grabbing md:hidden"
        initial={{ y: '100%' }}
        animate={controls}
        exit={{ y: '100%' }}
        transition={transitionProps}
        drag="y"
        dragDirectionLock
        onDragEnd={handleDragEnd}
        dragElastic={{ top: 0, bottom: 1 }}
        dragConstraints={{ top: 0, bottom: 0 }}
      >
        <div className="-mb-1 flex h-7 w-full items-center justify-center rounded-t-[16px] border-t border-neutral-200">
          <div className="-mr-1 h-1 w-6 rounded-full bg-neutral-300 transition-all group-active:rotate-12" />
          <div className="h-1 w-6 rounded-full bg-neutral-300 transition-all group-active:-rotate-12" />
        </div>
        {children}
        <div className="h-5 bg-neutral-50" />
      </motion.div>
      <motion.div
        key="leaflet-backdrop"
        className="fixed inset-0 z-[60] bg-neutral-900/10 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => setShow(false)}
      />
    </AnimatePresence>
  );
}
