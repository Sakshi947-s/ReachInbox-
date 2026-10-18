'use client';

import React, { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';
import { Sender, RecipientParseStats } from '@/types';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Upload,
  X,
  FileText,
  Clock,
  Calendar,
  Send,
  Loader2,
  Trash2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link as LinkIcon,
  Image as ImageIcon,
  Paperclip,
  RotateCcw,
  RotateCw,
  ChevronDown,
} from 'lucide-react';

interface ComposeViewProps {
  onBack: () => void;
  onSuccess: () => void;
  senders: Sender[];
}

export const ComposeView: React.FC<ComposeViewProps> = ({ onBack, onSuccess, senders }) => {
  const [senderId, setSenderId] = useState(senders[0]?.id || '');
  const [recipientInput, setRecipientInput] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(100);

  const [attachments, setAttachments] = useState<{ name: string; size: string; previewUrl?: string }[]>([]);

  // Bulk CSV Upload
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [parseStats, setParseStats] = useState<RecipientParseStats | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  // Scheduling / Send Later
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000); // 1 hour ahead
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [selectedQuickTime, setSelectedQuickTime] = useState<string | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (senders.length > 0 && !senderId) {
      setSenderId(senders[0].id);
    }
  }, [senders, senderId]);

  // Recipient chip management
  const addRecipient = (emailVal: string) => {
    const trimmed = emailVal.trim().replace(/,/g, '');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (trimmed && emailRegex.test(trimmed) && !recipients.includes(trimmed)) {
      setRecipients((prev) => [...prev, trimmed]);
      setRecipientInput('');
    } else if (trimmed && !emailRegex.test(trimmed)) {
      toast.error(`Invalid email format: ${trimmed}`);
    }
  };

  const handleRecipientKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
      e.preventDefault();
      addRecipient(recipientInput);
    } else if (e.key === 'Backspace' && !recipientInput && recipients.length > 0) {
      setRecipients((prev) => prev.slice(0, -1));
    }
  };

  const removeRecipient = (indexToRemove: number) => {
    setRecipients((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // CSV parsing
  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.parseRecipients(formData);
      setParseStats(res.data);

      const text = await file.text();
      setCsvContent(text);

      if (res.data?.validSample) {
        const newEmails = res.data.validSample.slice(0, 10);
        setRecipients((prev) => Array.from(new Set([...prev, ...newEmails])));
      }
      toast.success(`Imported ${res.data.validCount} recipients from ${file.name}`);
    } catch (err: any) {
      toast.error('Failed to parse CSV: ' + err.message);
    } finally {
      setIsParsing(false);
    }
  };

  // Attachments picker
  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments = Array.from(files).map((f) => ({
      name: f.name,
      size: `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
    }));

    setAttachments((prev) => [...prev, ...newAttachments]);
    toast.success(`Attached ${files.length} file(s)`);
  };

  const removeAttachment = (indexToRemove: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Formatting helpers for the textarea
  const applyFormatting = (tag: string) => {
    const textarea = editorRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const selected = text.slice(start, end);

    let replacement = '';
    switch (tag) {
      case 'bold':
        replacement = `<b>${selected || 'bold text'}</b>`;
        break;
      case 'italic':
        replacement = `<i>${selected || 'italic text'}</i>`;
        break;
      case 'underline':
        replacement = `<u>${selected || 'underlined text'}</u>`;
        break;
      case 'strike':
        replacement = `<s>${selected || 'strikethrough text'}</s>`;
        break;
      case 'h2':
        replacement = `\n<h2>${selected || 'Heading'}</h2>\n`;
        break;
      case 'ul':
        replacement = `\n<ul>\n  <li>${selected || 'List item'}</li>\n</ul>\n`;
        break;
      case 'ol':
        replacement = `\n<ol>\n  <li>${selected || 'First item'}</li>\n</ol>\n`;
        break;
      case 'link':
        replacement = `<a href="https://example.com">${selected || 'link text'}</a>`;
        break;
      default:
        replacement = selected;
    }

    const newText = text.slice(0, start) + replacement + text.slice(end);
    setBody(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + replacement.length, start + replacement.length);
    }, 0);
  };

  // Quick schedule presets
  const handleQuickPreset = (preset: '10am' | '1130am' | '2pm') => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (preset === '10am') {
      tomorrow.setHours(10, 0, 0, 0);
      setSelectedQuickTime('Tomorrow, 10:00 AM');
    } else if (preset === '1130am') {
      tomorrow.setHours(11, 30, 0, 0);
      setSelectedQuickTime('Tomorrow, 11:30 AM');
    } else {
      tomorrow.setHours(14, 0, 0, 0);
      setSelectedQuickTime('Tomorrow, 2:00 PM');
    }

    const formatted = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setScheduledDateTime(formatted);
  };

  // Submit Handler
  const executeSend = async (scheduledTime?: string) => {
    // If recipient input has pending text, add it
    if (recipientInput.trim()) {
      addRecipient(recipientInput);
    }

    const allRecipients = recipientInput.trim()
      ? Array.from(new Set([...recipients, recipientInput.trim()]))
      : recipients;

    if (!subject.trim()) {
      toast.error('Please enter an email subject');
      return;
    }

    if (!body.trim()) {
      toast.error('Please write an email body');
      return;
    }

    if (allRecipients.length === 0 && !csvContent) {
      toast.error('Please specify at least one recipient or upload a list');
      return;
    }

    setIsSubmitting(true);
    try {
      const isDelayed = Boolean(scheduledTime);
      const targetTime = isDelayed
        ? new Date(scheduledTime!).toISOString()
        : new Date(Date.now() + 500).toISOString();

      const payload: any = {
        name: subject,
        subject,
        body,
        startTime: targetTime,
        delayBetweenEmailsMs: Math.max(0, delaySeconds * 1000),
        hourlyLimit: Math.max(1, hourlyLimit),
        senderId: senderId || undefined,
      };

      if (csvContent) {
        payload.csvContent = csvContent;
      } else {
        payload.recipients = allRecipients;
      }

      const res = await api.createCampaign(payload);
      const count = res.campaign?.totalRecipients || allRecipients.length;

      if (isDelayed) {
        toast.success(`Scheduled ${count} email(s) for ${new Date(targetTime).toLocaleString()}!`);
      } else {
        toast.success(`Enqueued ${count} email(s) for immediate delivery!`);
      }

      setShowScheduleModal(false);
      onSuccess();
      onBack();
    } catch (err: any) {
      toast.error('Failed to schedule email: ' + (err.message || 'Server error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeSender = senders.find((s) => s.id === senderId) || senders[0];

  return (
    <div className="flex flex-col h-full bg-white relative">
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleCsvUpload}
        accept=".csv,.txt"
        className="hidden"
      />
      <input
        type="file"
        ref={attachmentInputRef}
        onChange={handleAttachmentUpload}
        multiple
        className="hidden"
      />

      {/* Top Bar matching Figma */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center"
            title="Back to inbox"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-base font-semibold text-gray-900 tracking-tight">
            Compose New Email
          </h1>
        </div>

        {/* Action Buttons Top-Right */}
        <div className="flex items-center space-x-2.5">
          {/* Send Now Button */}
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => executeSend()}
            className="px-4 py-2 border border-gray-200 hover:bg-gray-50 active:bg-gray-100 text-gray-700 text-sm font-medium rounded-xl transition-all shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus:outline-none focus:ring-2 focus:ring-green-500/20"
          >
            Send
          </button>

          {/* Send Later Button (Green) */}
          <button
            type="button"
            onClick={() => setShowScheduleModal(true)}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white text-sm font-medium rounded-xl transition-all shadow-sm flex items-center space-x-1.5 focus:outline-none focus:ring-2 focus:ring-green-500/30"
          >
            <span>Send Later</span>
            <ChevronDown className="w-4 h-4 opacity-80" />
          </button>
        </div>
      </div>

      {/* Form Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 max-w-5xl mx-auto w-full space-y-4">
        {/* FROM Field */}
        <div className="flex items-center py-2 border-b border-gray-100">
          <label className="w-20 text-xs font-medium text-gray-400">From</label>
          <div className="flex-1">
            <select
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              className="text-sm font-medium text-gray-800 bg-transparent border-0 focus:ring-0 p-0 cursor-pointer outline-none"
            >
              {senders.length > 0 ? (
                senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.email}
                  </option>
                ))
              ) : (
                <option value="">No sender configured</option>
              )}
            </select>
          </div>
        </div>

        {/* TO Field with Chips and Upload List */}
        <div className="flex items-center py-2 border-b border-gray-100">
          <label className="w-20 text-xs font-medium text-gray-400">To</label>
          <div className="flex-1 flex flex-wrap items-center gap-1.5">
            {/* Email Chips */}
            {recipients.map((email, idx) => (
              <span
                key={idx}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200/80 group"
              >
                <span>{email}</span>
                <button
                  type="button"
                  onClick={() => removeRecipient(idx)}
                  className="ml-1.5 text-green-500 hover:text-green-700 focus:outline-none"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            {/* Email Input */}
            <input
              type="text"
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              onKeyDown={handleRecipientKeyDown}
              onBlur={() => recipientInput.trim() && addRecipient(recipientInput)}
              placeholder={recipients.length === 0 ? 'recipient@example.com (press Enter or comma)' : 'Add another...'}
              className="flex-1 min-w-[200px] text-sm text-gray-800 bg-transparent border-0 focus:ring-0 p-1 placeholder-gray-400 outline-none"
            />
          </div>

          {/* Upload List Link */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs font-medium text-green-600 hover:text-green-700 flex items-center space-x-1 ml-4 pl-3 border-l border-gray-200"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload List</span>
          </button>
        </div>

        {/* SUBJECT Field */}
        <div className="flex items-center py-2 border-b border-gray-100">
          <label className="w-20 text-xs font-medium text-gray-400">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="flex-1 text-sm font-medium text-gray-800 bg-transparent border-0 focus:ring-0 p-0 placeholder-gray-400 outline-none"
          />
        </div>

        {/* INLINE SCHEDULING CONTROLS (Delay between 2 emails & Hourly limit) */}
        <div className="flex items-center space-x-6 py-2 text-xs text-gray-600 border-b border-gray-100">
          <div className="flex items-center space-x-2">
            <span>Delay between 2 emails:</span>
            <input
              type="number"
              min="0"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(parseInt(e.target.value, 10) || 0)}
              className="w-12 px-2 py-1 text-xs text-center border border-gray-200 rounded-md bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <span>s</span>
          </div>

          <div className="flex items-center space-x-2">
            <span>Hourly Limit:</span>
            <input
              type="number"
              min="1"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 100)}
              className="w-16 px-2 py-1 text-xs text-center border border-gray-200 rounded-md bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
        </div>

        {/* EMAIL BODY EDITOR WITH TOOLBAR */}
        <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.02)] focus-within:border-gray-300">
          {/* Formatting Toolbar */}
          <div className="flex flex-wrap items-center gap-1 px-4 py-2 bg-gray-50/80 border-b border-gray-200 text-gray-600">
            <button
              type="button"
              onClick={() => applyFormatting('bold')}
              className="p-1.5 hover:bg-gray-200/80 rounded transition-colors"
              title="Bold"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('italic')}
              className="p-1.5 hover:bg-gray-200/80 rounded transition-colors"
              title="Italic"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('underline')}
              className="p-1.5 hover:bg-gray-200/80 rounded transition-colors"
              title="Underline"
            >
              <Underline className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('strike')}
              className="p-1.5 hover:bg-gray-200/80 rounded transition-colors"
              title="Strikethrough"
            >
              <Strikethrough className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-4 bg-gray-300 mx-1" />

            <button
              type="button"
              onClick={() => applyFormatting('h2')}
              className="p-1.5 hover:bg-gray-200/80 rounded transition-colors"
              title="Heading"
            >
              <Heading className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('ul')}
              className="p-1.5 hover:bg-gray-200/80 rounded transition-colors"
              title="Bullet list"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => applyFormatting('ol')}
              className="p-1.5 hover:bg-gray-200/80 rounded transition-colors"
              title="Numbered list"
            >
              <ListOrdered className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-4 bg-gray-300 mx-1" />

            <button
              type="button"
              onClick={() => applyFormatting('link')}
              className="p-1.5 hover:bg-gray-200/80 rounded transition-colors"
              title="Insert link"
            >
              <LinkIcon className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              className="p-1.5 hover:bg-gray-200/80 rounded transition-colors"
              title="Add attachment / image"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Typing Area */}
          <textarea
            ref={editorRef}
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type Your Reply..."
            className="w-full p-4 text-sm text-gray-800 placeholder-gray-400 bg-white border-0 focus:ring-0 outline-none resize-y leading-relaxed font-normal"
          />

          {/* Attachment Preview (Matching Artboard 7) */}
          {attachments.length > 0 && (
            <div className="px-4 py-3 bg-gray-50/50 border-t border-gray-100 flex flex-wrap gap-3">
              {attachments.map((att, idx) => (
                <div
                  key={idx}
                  className="flex items-center space-x-2.5 p-2 bg-white border border-gray-200 rounded-xl shadow-xs"
                >
                  <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-medium text-gray-800 max-w-[130px] truncate">
                      {att.name}
                    </p>
                    <p className="text-[10px] text-gray-400">{att.size}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="p-1 text-gray-400 hover:text-gray-600 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* SCHEDULE MODAL (SEND LATER POPOVER - Matching Artboard 6) */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-sm p-6 space-y-4 animate-in fade-in zoom-in-95 duration-100">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Pick date &amp; time</h3>
              <button
                onClick={() => setShowScheduleModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick preset options */}
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={() => handleQuickPreset('10am')}
                className={`w-full text-left px-3.5 py-2 rounded-xl text-xs font-medium transition-colors ${
                  selectedQuickTime === 'Tomorrow, 10:00 AM'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'text-gray-700 hover:bg-gray-50 border border-transparent'
                }`}
              >
                Tomorrow, 10:00 AM
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset('1130am')}
                className={`w-full text-left px-3.5 py-2 rounded-xl text-xs font-medium transition-colors ${
                  selectedQuickTime === 'Tomorrow, 11:30 AM'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'text-gray-700 hover:bg-gray-50 border border-transparent'
                }`}
              >
                Tomorrow, 11:30 AM
              </button>
              <button
                type="button"
                onClick={() => handleQuickPreset('2pm')}
                className={`w-full text-left px-3.5 py-2 rounded-xl text-xs font-medium transition-colors ${
                  selectedQuickTime === 'Tomorrow, 2:00 PM'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'text-gray-700 hover:bg-gray-50 border border-transparent'
                }`}
              >
                Tomorrow, 2:00 PM
              </button>
            </div>

            {/* Date & Time Input */}
            <div className="pt-2">
              <label className="block text-[11px] font-medium text-gray-500 mb-1">
                Custom Schedule Time
              </label>
              <input
                type="datetime-local"
                value={scheduledDateTime}
                onChange={(e) => {
                  setScheduledDateTime(e.target.value);
                  setSelectedQuickTime(null);
                }}
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-600"
              />
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => executeSend(scheduledDateTime)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors shadow-xs flex items-center space-x-1"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Scheduling...</span>
                  </>
                ) : (
                  <span>Schedule</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
