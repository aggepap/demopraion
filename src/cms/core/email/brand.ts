/**
 * The brand on outgoing email. Pure — no mailer, no DB, no `server-only`.
 *
 * Email builders are synchronous string templates spread across modules, and
 * threading the palette through every one of them would put a database read in
 * each. Instead a builder writes a placeholder — `emailColor('midnight-navy')` —
 * and the one place every mail passes through (`sendGraphMail`) swaps the
 * placeholders for the saved colours and puts the logo on top.
 */
import { BASE_PALETTE, type Palette, type PaletteToken } from '../brand/policy';
import { escapeHtml } from './format';

export interface EmailBrand {
  name: string;
  /** Absolute URL — a mail client has no origin to resolve a relative one against. */
  logoUrl: string | null;
  palette: Palette;
}

/** A placeholder for a brand colour in an email template. */
export const emailColor = (token: PaletteToken): string => `{{brand:${token}}}`;

const PLACEHOLDER = /\{\{brand:([a-z-]+)\}\}/g;

export function applyEmailBrand(html: string, brand: EmailBrand): string {
  const coloured = html.replace(PLACEHOLDER, (_, token: string) => {
    const palette = brand.palette as Record<string, string>;
    return palette[token] ?? (BASE_PALETTE as Record<string, string>)[token] ?? '';
  });
  if (!brand.logoUrl) return coloured;

  const header =
    `<div style="padding:0 0 16px;margin:0 0 16px;border-bottom:1px solid ${brand.palette['border-soft']};">` +
    `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.name)}" height="40" style="height:40px;width:auto;border:0;" />` +
    `</div>`;
  const body = /<body[^>]*>/i.exec(coloured);
  if (!body) return header + coloured;
  const at = body.index + body[0].length;
  return coloured.slice(0, at) + header + coloured.slice(at);
}
