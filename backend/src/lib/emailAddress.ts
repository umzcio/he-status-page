// Strict email address rules.
//
// Only a plain "local@domain" address is accepted: a dot-atom local part (no
// quoted strings, no whitespace or control characters of any kind) and a
// hostname domain. Anything looser lets the address we validate differ from
// the mailbox a mail library ends up delivering to.

const ATOM = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LOCAL_PART = new RegExp(`^${ATOM}(\\.${ATOM})*$`);
const DOMAIN = /^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/** The canonical (lowercased) form of a plain address, or null if it isn't one. */
export function canonicalAddress(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 254) return null;
  const at = input.lastIndexOf('@');
  if (at <= 0) return null;
  const local = input.slice(0, at);
  const domain = input.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local) || !DOMAIN.test(domain)) return null;
  return `${local}@${domain}`.toLowerCase();
}

/** Like canonicalAddress, but the domain must also be a .edu domain. */
export function canonicalEduAddress(input: unknown): string | null {
  const address = canonicalAddress(input);
  return address && address.slice(address.lastIndexOf('@') + 1).endsWith('.edu') ? address : null;
}
