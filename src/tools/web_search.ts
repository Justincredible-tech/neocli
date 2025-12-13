// src/tools/web_search.ts
/**
 * Web Search Tool
 * Searches the web for information using DuckDuckGo's API.
 * No API key required - uses the free instant answer API.
 */
import { Tool, ToolArgs } from '../types/index.js';
import { logger } from '../utils/logger.js';

interface WebSearchArgs extends ToolArgs {
  query: string;
  max_results?: number;
}

interface DuckDuckGoResult {
  Abstract: string;
  AbstractText: string;
  AbstractSource: string;
  AbstractURL: string;
  Image: string;
  Heading: string;
  Answer: string;
  AnswerType: string;
  Definition: string;
  DefinitionSource: string;
  DefinitionURL: string;
  RelatedTopics: Array<{
    Text: string;
    FirstURL: string;
    Icon?: { URL: string };
    Result: string;
  }>;
  Results: Array<{
    Text: string;
    FirstURL: string;
    Icon?: { URL: string };
    Result: string;
  }>;
  Type: string;
  Redirect: string;
}

const tool: Tool = {
  name: 'web_search',
  description: 'Search the web for information. Returns summaries and relevant links. Use for finding documentation, tutorials, or current information.',
  source: 'CORE',
  execute: async (args: ToolArgs): Promise<string> => {
    const { query, max_results = 5 } = args as WebSearchArgs;

    try {
      // 1. Validate input
      if (!query || typeof query !== 'string') {
        return "Error: 'query' parameter is required.";
      }

      const trimmedQuery = query.trim();
      if (trimmedQuery.length < 2) {
        return "Error: Query too short. Please provide a more specific search term.";
      }

      // 2. URL encode the query
      const encodedQuery = encodeURIComponent(trimmedQuery);

      // 3. Call DuckDuckGo Instant Answer API
      const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;

      logger.debug("Web search", { query: trimmedQuery, url });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'NeoCLI/2.3.0 (Web Search Tool)'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as DuckDuckGoResult;

      // 4. Build results
      const results: string[] = [];
      results.push(`Search Results for: "${trimmedQuery}"`);
      results.push('─'.repeat(40));

      let resultCount = 0;

      // Check for redirect (e.g., "!g" bang)
      if (data.Redirect) {
        results.push(`\nRedirect: ${data.Redirect}`);
        return results.join('\n');
      }

      // Direct answer
      if (data.Answer) {
        results.push(`\n📌 Direct Answer:`);
        results.push(data.Answer);
        resultCount++;
      }

      // Abstract/Summary
      if (data.AbstractText) {
        results.push(`\n📖 Summary (${data.AbstractSource || 'Unknown Source'}):`);
        results.push(data.AbstractText);
        if (data.AbstractURL) {
          results.push(`Source: ${data.AbstractURL}`);
        }
        resultCount++;
      }

      // Definition
      if (data.Definition) {
        results.push(`\n📚 Definition (${data.DefinitionSource || 'Unknown'}):`);
        results.push(data.Definition);
        if (data.DefinitionURL) {
          results.push(`Source: ${data.DefinitionURL}`);
        }
        resultCount++;
      }

      // Related topics
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        results.push(`\n🔗 Related Topics:`);
        const topics = data.RelatedTopics
          .filter(t => t.Text && t.FirstURL)
          .slice(0, max_results);

        for (const topic of topics) {
          if (topic.Text) {
            // Clean up the text (sometimes includes HTML formatting)
            const cleanText = topic.Text.replace(/<[^>]*>/g, '').substring(0, 200);
            results.push(`\n• ${cleanText}`);
            if (topic.FirstURL) {
              results.push(`  ${topic.FirstURL}`);
            }
            resultCount++;
          }
        }
      }

      // Direct results
      if (data.Results && data.Results.length > 0) {
        results.push(`\n🔎 Results:`);
        const directResults = data.Results.slice(0, max_results);

        for (const result of directResults) {
          if (result.Text) {
            const cleanText = result.Text.replace(/<[^>]*>/g, '').substring(0, 200);
            results.push(`\n• ${cleanText}`);
            if (result.FirstURL) {
              results.push(`  ${result.FirstURL}`);
            }
            resultCount++;
          }
        }
      }

      // No results found
      if (resultCount === 0) {
        results.push(`\nNo direct results found for "${trimmedQuery}".`);
        results.push('\nTips:');
        results.push('• Try more specific keywords');
        results.push('• Check spelling');
        results.push('• Use fewer words');
        results.push('• Try the web_fetcher skill with a specific URL');
      }

      results.push('\n' + '─'.repeat(40));
      results.push(`Found ${resultCount} result(s)`);

      return results.join('\n');

    } catch (e: unknown) {
      const error = e as Error;

      if (error.name === 'AbortError') {
        return 'Error: Search request timed out. Try again or use a more specific query.';
      }

      logger.error("Web search failed", error);
      return `Error searching web: ${error.message}`;
    }
  }
};

export default tool;
