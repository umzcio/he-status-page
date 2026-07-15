import { describe, it, expect } from 'vitest';
import { verificationEmail, statusChangeEmail, testEmail } from '../emailTemplates';

describe('email templates', () => {
  describe('verificationEmail', () => {
    it('includes the verification token in the URL', () => {
      const result = verificationEmail('abc123');
      expect(result.subject).toContain('Verify');
      expect(result.html).toContain('abc123');
      expect(result.html).toContain('/api/subscriptions/verify/abc123');
    });

    it('includes site branding', () => {
      const result = verificationEmail('token');
      expect(result.html).toContain('#1e40af'); // default primary color
      expect(result.html).toContain('IT Status');
    });
  });

  describe('statusChangeEmail', () => {
    it('includes service name and status transitions', () => {
      const result = statusChangeEmail('Microsoft 365', 'operational', 'outage', 'unsub123');
      expect(result.subject).toContain('Microsoft 365');
      expect(result.html).toContain('Microsoft 365');
      expect(result.html).toContain('unsub123');
    });

    it('includes unsubscribe link', () => {
      const result = statusChangeEmail('Zoom', 'operational', 'degraded', 'token456');
      expect(result.html).toContain('/api/subscriptions/unsubscribe/token456');
      expect(result.html).toContain('Unsubscribe');
    });
  });

  describe('testEmail', () => {
    it('returns a test email with subject and html', () => {
      const result = testEmail();
      expect(result.subject).toContain('Test');
      expect(result.html).toContain('test email');
    });
  });
});
