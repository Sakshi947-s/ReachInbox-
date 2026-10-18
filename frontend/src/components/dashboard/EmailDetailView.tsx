'use client';

import React from 'react';
import { EmailJob } from '@/types';
import { ArrowLeft, ExternalLink, CheckCircle2 } from 'lucide-react';

interface EmailDetailViewProps {
  email: EmailJob;
  onBack: () => void;
}

export const EmailDetailView: React.FC<EmailDetailViewProps> = ({ email, onBack }) => {
  const senderName = email.sender?.displayName || 'ReachInbox Scheduler';
  const senderEmail = email.sender?.email || 'scheduler@reachinbox.ai';
  const senderInitial = (senderName.charAt(0) || 'A').toUpperCase();

  const formattedDate = email.sentAt
    ? new Date(email.sentAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : new Date(email.scheduledAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

  // Extract clean text if body is HTML
  const isHtml = email.bodySnapshot?.includes('<') && email.bodySnapshot?.includes('>');

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Top Header with Back Button and Subject */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white">
        <div className="flex items-center space-x-3 max-w-3xl">
          <button
            onClick={onBack}
            className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center"
            title="Back to list"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold text-gray-900 truncate tracking-tight">
            {email.subjectSnapshot || 'No Subject'}
          </h1>
        </div>

        {email.etherealPreviewUrl && (
          <a
            href={email.etherealPreviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg transition-colors"
          >
            <span>View on Ethereal</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>

      {/* Email Body Card */}
      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full">
        <div className="bg-white rounded-2xl border border-gray-100 p-8 shadow-[0_2px_12px_rgba(0,0,0,0.02)] space-y-6">
          {/* Sender & Recipient Header */}
          <div className="flex items-start justify-between pb-6 border-b border-gray-100">
            <div className="flex items-center space-x-3.5">
              {/* Green circular avatar with sender initial */}
              <div className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center font-semibold text-sm shadow-sm flex-shrink-0">
                {senderInitial}
              </div>
              <div>
                <div className="flex items-baseline space-x-2">
                  <span className="font-semibold text-sm text-gray-900">{senderName}</span>
                  <span className="text-xs text-gray-400 font-normal">&lt;{senderEmail}&gt;</span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  to <span className="text-gray-600 font-medium">{email.recipientEmail}</span>
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-400 font-normal whitespace-nowrap">
              {formattedDate}
            </div>
          </div>

          {/* Email Content */}
          <div className="text-sm text-gray-800 leading-relaxed space-y-4">
            {isHtml ? (
              <div
                className="prose prose-sm max-w-none text-gray-800"
                dangerouslySetInnerHTML={{ __html: email.bodySnapshot }}
              />
            ) : (
              <div className="whitespace-pre-line text-gray-800 font-normal">
                {email.bodySnapshot}
              </div>
            )}
          </div>

          {/* Sample callout box if present in Figma design */}
          <div className="p-4 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 leading-relaxed">
            <span className="font-semibold block mb-1">
              • Campaign Info: {email.campaign?.name || 'Scheduled Campaign'}
            </span>
            <span>
              Delivery status: {email.status === 'SENT' ? 'Delivered successfully' : 'Queued for delivery'}.
              {email.sentAt && ` Sent on ${new Date(email.sentAt).toLocaleString()}.`}
            </span>
          </div>

          {/* No attachment data is stored for scheduled/sent emails in this version */}
        </div>
      </div>
    </div>
  );
};
