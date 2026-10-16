'use client';

import React from 'react';
import { EmailJob, Pagination } from '@/types';
import { CheckCircle2, XCircle, ExternalLink, Send, AlertCircle } from 'lucide-react';

interface SentTableProps {
  emails: EmailJob[];
  loading: boolean;
  pagination: Pagination;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
}

export const SentTable: React.FC<SentTableProps> = ({
  emails,
  loading,
  pagination,
  onPageChange,
  onRefresh,
}) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SENT':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Delivered
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">
            {status}
          </span>
        );
    }
  };

  if (loading && emails.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="animate-pulse flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-4 bg-slate-200 rounded w-48" />
              <div className="h-3 bg-slate-100 rounded w-64" />
            </div>
            <div className="h-6 bg-slate-200 rounded w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
          <Send className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-800">No sent emails yet</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
          As soon as your scheduled campaign jobs reach their eligible send time, they will appear here along with live Ethereal test inbox preview links.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left">
          <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            <tr>
              <th scope="col" className="px-6 py-3.5">
                Recipient
              </th>
              <th scope="col" className="px-6 py-3.5">
                Subject
              </th>
              <th scope="col" className="px-6 py-3.5">
                Campaign
              </th>
              <th scope="col" className="px-6 py-3.5">
                Delivered At
              </th>
              <th scope="col" className="px-6 py-3.5">
                Status
              </th>
              <th scope="col" className="px-6 py-3.5 text-right">
                Ethereal Preview
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm">
            {emails.map((email) => (
              <tr key={email.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="font-medium text-slate-900">{email.recipientEmail}</div>
                  <div className="text-[11px] text-slate-400">
                    From: {email.sender?.displayName || email.sender?.email || 'Default'}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-slate-800 font-medium truncate max-w-xs">
                    {email.subjectSnapshot}
                  </div>
                  {email.errorMessage && (
                    <div className="text-[11px] text-red-600 flex items-center space-x-1 mt-0.5">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate max-w-xs">{email.errorMessage}</span>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                  {email.campaign?.name || 'Quick Campaign'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                  {email.sentAt ? (
                    <div>
                      <div className="font-medium text-slate-800">
                        {new Date(email.sentAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(email.sentAt).toLocaleDateString()}
                      </div>
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getStatusBadge(email.status)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                  {email.etherealPreviewUrl ? (
                    <a
                      href={email.etherealPreviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-1 px-2.5 py-1 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md font-medium transition-colors border border-indigo-200/50"
                    >
                      <span>Preview Email</span>
                      <ExternalLink className="w-3 h-3 ml-0.5" />
                    </a>
                  ) : (
                    <span className="text-slate-400 text-xs italic">No preview URL</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {pagination.totalPages > 1 && (
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>
            Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
            {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}{' '}
            emails
          </span>
          <div className="flex space-x-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-2.5 py-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-2 py-1 font-medium text-slate-800">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-2.5 py-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
