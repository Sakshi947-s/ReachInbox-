'use client';

import React from 'react';
import { EmailJob, Pagination } from '@/types';
import { Clock, Send, ExternalLink, Trash2 } from 'lucide-react';

interface EmailTableProps {
  type: 'scheduled' | 'sent';
  emails: EmailJob[];
  loading: boolean;
  pagination: Pagination;
  onPageChange: (page: number) => void;
  onSelectEmail: (email: EmailJob) => void;
  onCancelEmail?: (id: string) => void;
}

/**
 * Formats a date as the Figma shows: "Tue 9:15:12 AM"
 */
function formatBadgeTime(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  return `${day} ${time}`;
}

/**
 * Strips HTML tags for a clean body preview.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>?/gm, '').trim();
}

export const EmailTable: React.FC<EmailTableProps> = ({
  type,
  emails,
  loading,
  pagination,
  onPageChange,
  onSelectEmail,
  onCancelEmail,
}) => {
  const isScheduled = type === 'scheduled';

  /* ─── Loading skeleton ─── */
  if (loading && emails.length === 0) {
    return (
      <div className="divide-y divide-gray-100">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="px-6 py-4 flex items-center space-x-4 animate-pulse">
            <div className="w-32 h-3.5 bg-gray-100 rounded" />
            <div className="w-28 h-5 bg-orange-50 rounded-full" />
            <div className="flex-1 h-3.5 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  /* ─── Empty state ─── */
  if (emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="w-11 h-11 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center mb-3">
          {isScheduled ? (
            <Clock className="w-5 h-5 text-gray-300" />
          ) : (
            <Send className="w-5 h-5 text-gray-300" />
          )}
        </div>
        <p className="text-sm font-semibold text-gray-700">
          {isScheduled ? 'No scheduled emails' : 'No sent emails'}
        </p>
        <p className="text-xs text-gray-400 mt-1 max-w-xs">
          {isScheduled
            ? 'Emails you schedule will appear here with their delivery time.'
            : 'Delivered emails will be listed here with preview links.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ─── Email rows ─── */}
      <div className="flex-1 divide-y divide-gray-100/80">
        {emails.map((email) => {
          const timeDate = isScheduled ? email.scheduledAt : email.sentAt;
          const badgeLabel = formatBadgeTime(timeDate);
          const bodyPreview = stripHtml(email.bodySnapshot || '');

          return (
            <div
              key={email.id}
              onClick={() => onSelectEmail(email)}
              className="group flex items-center px-6 py-3.5 hover:bg-gray-50/70 transition-colors cursor-pointer"
            >
              {/* Recipient – fixed width */}
              <div className="w-40 flex-shrink-0">
                <span className="text-[13px] font-medium text-gray-800 truncate block">
                  To: {email.recipientEmail.split('@')[0]}
                </span>
              </div>

              {/* Time badge */}
              <div className="flex-shrink-0 mr-3">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-orange-50 text-orange-500 whitespace-nowrap border border-orange-100">
                  <Clock className="w-3 h-3 flex-shrink-0" />
                  {badgeLabel}
                </span>
              </div>

              {/* Subject – preview */}
              <div className="flex-1 min-w-0 flex items-center space-x-1.5 text-[13px]">
                <span className="font-semibold text-gray-800 flex-shrink-0 truncate max-w-[220px]">
                  {email.subjectSnapshot || 'No subject'}
                </span>
                <span className="text-gray-300 flex-shrink-0">-</span>
                <span className="text-gray-400 truncate font-normal">
                  {bodyPreview || 'No content preview'}
                </span>
              </div>

              {/* Right actions */}
              <div className="flex items-center space-x-1 flex-shrink-0 pl-3">
                {/* Ethereal preview link */}
                {email.etherealPreviewUrl && (
                  <a
                    href={email.etherealPreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 text-gray-300 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    title="View Ethereal email preview"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                {/* Cancel (scheduled only) */}
                {isScheduled && onCancelEmail && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelEmail(email.campaignId || email.id);
                    }}
                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    title="Cancel campaign"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Pagination ─── */}
      {pagination.totalPages > 1 && (
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 bg-white">
          <span>
            {(pagination.page - 1) * pagination.limit + 1}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </span>
          <div className="flex items-center space-x-1">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="px-2 py-1 font-medium text-gray-600 tabular-nums">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
