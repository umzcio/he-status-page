import { describe, it, expect } from 'vitest';
import { cleanStatusText, MAX_STATUS_MESSAGE_LENGTH } from '../text';
import { buildStatusChangeCard, escapeCardMarkdown } from '../teams';

describe('cleanStatusText', () => {
  it('turns non-strings into an empty string', () => {
    expect(cleanStatusText(undefined)).toBe('');
    expect(cleanStatusText({ evil: true })).toBe('');
    expect(cleanStatusText(42)).toBe('');
  });

  it('removes control and bidi characters and collapses whitespace', () => {
    expect(cleanStatusText('  Partial\u0000 outage\n\tin‮  EU  ')).toBe('Partial outage in EU');
  });

  it('caps the length', () => {
    const out = cleanStatusText('x'.repeat(10_000));
    expect(out.length).toBe(MAX_STATUS_MESSAGE_LENGTH);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('Teams card text', () => {
  it('neutralizes markdown links, emphasis and list markers', () => {
    expect(escapeCardMarkdown('[x](https://example.com) **bold** _it_')).toBe(
      '\\[x\\]\\(https://example.com\\) \\*\\*bold\\*\\* \\_it\\_'
    );
    expect(escapeCardMarkdown('- item')).toBe('\\- item');
    expect(escapeCardMarkdown('zoom.us is degraded')).toBe('zoom.us is degraded');
  });

  it('escapes provider text and names in the posted card', () => {
    const card: any = buildStatusChangeCard({
      serviceId: 's',
      serviceName: '[Zoom](https://evil.example)',
      categorySlug: 'c',
      oldStatus: 'operational',
      newStatus: 'degraded',
      statusMessage: `[click](https://evil.example) **now** ${'y'.repeat(5000)}`,
      overrideInfo: { userName: 'a@example.edu', reason: '[r](https://evil.example)' },
    });
    const body = card.attachments[0].content.body;
    const title: string = body[0].items[0].text;
    const facts: Array<{ title: string; value: string }> = body[1].facts;
    const message = facts.find((f) => f.title === 'Message')!.value;

    expect(title).toContain('\\[Zoom\\]\\(https://evil.example\\)');
    expect(message.startsWith('\\[click\\]\\(https://evil.example\\) \\*\\*now\\*\\*')).toBe(true);
    expect(message.length).toBeLessThan(MAX_STATUS_MESSAGE_LENGTH + 50);
    expect(facts.find((f) => f.title === 'Reason')!.value).toBe('\\[r\\]\\(https://evil.example\\)');
    for (const fact of facts) expect(fact.value).not.toMatch(/(^|[^\\])\[[^\]]*[^\\]\]\(/);
  });
});
