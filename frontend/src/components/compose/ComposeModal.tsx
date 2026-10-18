'use client';

import React from 'react';
import { Sender } from '@/types';
import { ComposeView } from './ComposeView';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  senders: Sender[];
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  senders,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full border border-gray-200 overflow-hidden transform transition-all h-[90vh] flex flex-col">
        <ComposeView
          onBack={onClose}
          onSuccess={() => {
            onSuccess();
            onClose();
          }}
          senders={senders}
        />
      </div>
    </div>
  );
};
