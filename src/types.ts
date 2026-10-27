export type FaxStatus = 'received' | 'sent' | 'queued' | 'failed';
export type Fax = {
  id: string; title: string; contact: string; number: string; pages: number;
  status: FaxStatus; direction: 'inbound' | 'outbound'; createdAt: string;
  unread?: boolean; archived?: boolean; source?: 'live'; hasDocument?: boolean;
};
export type Page = 'dashboard' | 'inbox' | 'sent' | 'compose' | 'contacts' |
  'documents' | 'numbers' | 'team' | 'reports' | 'server' | 'sip' | 'queue' |
  'security' | 'settings' | 'backups' | 'archive' | 'viewer';
