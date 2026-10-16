'use client';

import React from 'react';
import { EmailJob, Pagination } from '@/types';
import { Calendar, Clock, AlertCircle, XCircle, RefreshCw } from 'lucide-react';

interface ScheduledTableProps {
  emails: EmailJob[];
  loading: boolean;
  pagination: Pagination;
  onPageChange: (page: number) => void;
  onCancelJob?: (id: string) => void;
  onRefresh: () => void;
}

export const ScheduledTable: React.FC<ScheduledTableProps> = ({
  emails,
  loading,
  pagination,
  onPageChange,
  onCancelJob,
  onRefresh,
}) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SCHEDULED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
            <Clock className="w-3 h-3 mr-1" />
            Scheduled
          </span>
        );
      case 'QUEUED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            Queued
          </span>
        );
      case 'PROCESSING':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
            Sending...
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
          <Calendar className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-800">No scheduled emails</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
          You don&apos;t have any upcoming delayed email jobs. Click &quot;Compose Email&quot; above to schedule your next campaign.
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
                Scheduled Send Time
              </th>
              <th scope="col" className="px-6 py-3.5">
                Status
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
                    <div className="text-[11px] text-amber-600 flex items-center space-x-1 mt-0.5">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate max-w-xs">{email.errorMessage}</span>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                  {email.campaign?.name || 'Quick Campaign'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                  <div className="font-medium text-slate-800">
                    {new Date(email.scheduledAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {new Date(email.scheduledAt).toLocaleDateString()}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {getStatusBadge(email.status)}
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
