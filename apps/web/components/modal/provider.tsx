'use client';

import {
  type ReactNode,
  createContext,
  useContext,
  useState,
  useEffect,
} from 'react';
import Modal from '.';

export type ModalOptions = {
  noLeaflet?: boolean;
  backdropClassName?: string;
  notDismissible?: boolean;
};

interface ModalContextProps {
  show: (content: ReactNode, options?: ModalOptions) => void;
  hide: () => void;
}

const ModalContext = createContext<ModalContextProps | undefined>(undefined);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modalContent, setModalContent] = useState<ReactNode | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [modalOptions, setModalOptions] = useState<ModalOptions | undefined>(
    undefined,
  );

  useEffect(() => {
    if (showModal) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showModal]);

  const show = (content: ReactNode, options?: ModalOptions) => {
    if (options) setModalOptions(options);
    setModalContent(content);
    setShowModal(true);
  };

  const hide = () => {
    setShowModal(false);
    setTimeout(() => {
      setModalOptions(undefined);
      setModalContent(null);
    }, 300);
  };

  return (
    <ModalContext.Provider value={{ show, hide }}>
      {children}
      {showModal && (
        <Modal
          showModal={showModal}
          setShowModal={setShowModal}
          options={modalOptions}
        >
          {modalContent}
        </Modal>
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
}
