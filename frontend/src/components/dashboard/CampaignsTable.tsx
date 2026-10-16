'use client';

import React from 'react';
import { Campaign, Pagination } from '@/types';
import { Layers, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';

interface CampaignsTableProps {
  campaigns: Campaign[];
  loading: boolean;
  pagination: Pagination;
  onPageChange: (page: number) => void;
  onCancelCampaign: (id: string) => void;
  onRefresh: () => void;
}

export const CampaignsTable: React.FC<CampaignsTableProps> = ({
  campaigns,
  loading,
  pagination,
  onPageChange,
  onCancelCampaign,
}) => {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
            <Clock className="w-3 h-3 mr-1 animate-spin" />
            In Progress
          </span>
        );
      case 'SCHEDULED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">
            <Clock className="w-3 h-3 mr-1" />
            Scheduled
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
            <XCircle className="w-3 h-3 mr-1" />
            Cancelled
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

  if (loading && campaigns.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-4">
        {[1, 2, 3].map((i) => (
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

  if (campaigns.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
          <Layers className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-800">No campaigns created yet</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
          Start your first scheduled campaign by clicking &quot;Compose Email&quot; in the navigation bar above.
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
              <th scope="col" className="px-6 py-3.5">Campaign Name / Subject</th>
              <th scope="col" className="px-6 py-3.5">Start Time</th>
              <th scope="col" className="px-6 py-3.5">Throttling Rules</th>
              <th scope="col" className="px-6 py-3.5">Progress</th>
              <th scope="col" className="px-6 py-3.5">Status</th>
              <th scope="col" className="px-6 py-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-sm">
            {campaigns.map((camp) => {
              const progressPct = camp.totalRecipients > 0
                ? Math.round(((camp.sentCount + camp.failedCount) / camp.totalRecipients) * 100)
                : 0;

              return (
                <tr key={camp.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-900">{camp.name || camp.subject}</div>
                    <div className="text-xs text-slate-500 truncate max-w-xs">{camp.subject}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                    <div>{new Date(camp.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="text-[10px] text-slate-400">{new Date(camp.startTime).toLocaleDateString()}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-600">
                    <div>{camp.delayBetweenEmailsMs / 1000}s interval</div>
                    <div className="text-[10px] text-slate-400">Max {camp.hourlyLimit}/hr quota</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs">
                    <div className="flex items-center space-x-2">
                      <div className="w-24 bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="font-medium text-slate-700">
                        {camp.sentCount}/{camp.totalRecipients}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(camp.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-xs">
                    {['SCHEDULED', 'IN_PROGRESS'].includes(camp.status) && (
                      <button
                        onClick={() => onCancelCampaign(camp.id)}
                        className="text-red-600 hover:text-red-800 font-medium hover:underline"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pagination.totalPages > 1 && (
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>Page {pagination.page} of {pagination.totalPages}</span>
          <div className="flex space-x-2">
            <button
              onClick={() => onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-2.5 py-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
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
