/* NEO_SKILL_META
{
  "name": "web_search_google",
  "description": "Perform a Google web search via the Custom Search API and return concise results.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Search query terms." },
      "limit": { "type": "number", "description": "Number of results to return (1-10, default 5)." }
    },
    "required": ["query"]
  }
}
NEO_SKILL_META */

type SearchArgs = { query?: string; limit?: number };

interface SearchItem {
  title: string;
  link: string;
  snippet: string;
}

interface GoogleResponse {
  items?: Array<{ title?: string; link?: string; snippet?: string }>;
  error?: { message?: string };
}

export async function run(args: SearchArgs): Promise<string> {
  const query = (args.query || '').trim();
  const limit = clamp(args.limit ?? 5, 1, 10);

  if (!query) {
    return "Error: Please provide a non-empty search query.";
  }

  const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID || process.env.GOOGLE_CX;

  if (!apiKey || !cx) {
    return "Error: Google Custom Search API credentials missing. Set GOOGLE_API_KEY (or GOOGLE_CSE_API_KEY) and GOOGLE_CSE_ID (or GOOGLE_CX).";
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(limit));

  try {
    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      return `Search failed (${response.status}): ${response.statusText}`;
    }

    const data = (await response.json()) as GoogleResponse;
    if (data.error?.message) {
      return `Search API error: ${data.error.message}`;
    }

    const items = (data.items || [])
      .map(toItem)
      .filter((i): i is SearchItem => Boolean(i));

    if (items.length === 0) {
      return `No results for "${query}".`;
    }

    return formatResults(query, items);
  } catch (error: any) {
    return `Search error: ${error.message || 'Unknown error'}`;
  }
}

function toItem(raw: { title?: string; link?: string; snippet?: string }): SearchItem | null {
  if (!raw.link || !raw.title) return null;
  return {
    title: raw.title,
    link: raw.link,
    snippet: (raw.snippet || '').trim()
  };
}

function formatResults(query: string, items: SearchItem[]): string {
  const lines = [`Google search results for: "${query}"`];
  items.forEach((item, idx) => {
    lines.push(
      `\n${idx + 1}. ${item.title}`,
      `   ${item.link}`,
      item.snippet ? `   ${item.snippet}` : ''
    );
  });
  return lines.join('\n');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
