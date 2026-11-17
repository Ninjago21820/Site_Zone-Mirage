import 'express';

export interface PublicUser {
  id: string;
  mirage_id: string;
  username: string;
  email: string | null;
  role: string;
  status: string;
  password_hash: string | null;
  locale: string;
  profile_public: number;
  show_socials: number;
  socials_json: string;
  bio: string;
  totp_secret: string | null;
  totp_last_step: number | null;
  webauthn_required: number;
  backup_codes_left: number;
  failed_count: number;
  fail_window_start: number;
  last_failed_at: number;
  reauth_at: number;
  email_verified: number;
  deletion_requested_at: number | null;
  purge_after: number | null;
  created_at: number;
  updated_at: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser | null;
      session?: import('./lib/sessions.js').SessionRow | null;
      sessionToken?: string;
      ipTrunc?: string;
      ctxChanged?: boolean;
      csrfCookie?: string;
      requestId?: string;
    }
  }
}
