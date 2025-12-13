/* NEO_SKILL_META
{
  "name": "dns_resolver",
  "description": "Performs DNS lookups (TXT, MX, A) to verify SPF/DMARC records.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "domain": { "type": "string", "description": "Domain to query (e.g. google.com)" },
      "recordType": { "type": "string", "enum": ["TXT", "MX", "A", "NS"], "default": "TXT" }
    },
    "required": ["domain"]
  }
}
NEO_SKILL_META */

import dns from 'dns';
import { promisify } from 'util';

const resolveTxt = promisify(dns.resolveTxt);
const resolveMx = promisify(dns.resolveMx);
const resolve4 = promisify(dns.resolve4);
const resolveNs = promisify(dns.resolveNs);

export async function run(args: { domain: string; recordType?: string }) {
  const { domain, recordType = 'TXT' } = args;

  try {
    let result;
    switch (recordType.toUpperCase()) {
      case 'TXT':
        // TXT records come as arrays of arrays of strings. Flatten them.
        const txts = await resolveTxt(domain);
        result = txts.map(chunk => chunk.join('')); // Rejoin chunks
        // Highlight SPF/DMARC for readability
        result = result.map(r => {
           if (r.startsWith('v=spf1')) return `🔒 [SPF] ${r}`;
           if (r.startsWith('v=DMARC1')) return `🛡️ [DMARC] ${r}`;
           return r;
        });
        break;
      
      case 'MX':
        const mxs = await resolveMx(domain);
        result = mxs.sort((a, b) => a.priority - b.priority);
        break;

      case 'A':
        result = await resolve4(domain);
        break;

      case 'NS':
        result = await resolveNs(domain);
        break;

      default:
        return "Unsupported record type.";
    }

    return JSON.stringify({ domain, recordType, records: result }, null, 2);

  } catch (e: any) {
    return `DNS Lookup Failed: ${e.message} (Code: ${e.code})`;
  }
}