// Keeps the progressive-delay backoff fast enough for tests while still
// exercising the exact same code path as production.
process.env.THROTTLE_BASE_DELAY_MS = '1';
process.env.THROTTLE_MAX_DELAY_MS = '5';
process.env.NODE_ENV = 'test';
process.env.BACKUP_ENCRYPTION_KEY = 'test-only-backup-key-0123456789abcdef';
