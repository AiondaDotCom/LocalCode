import { execSync } from "node:child_process";
import type { ToolResult } from "../types.js";
import type { LocalTool } from "../mcp/servers/local.js";

interface BrowserPage {
  title: string;
  url: string;
  content: string;
}

const browserPages: Map<number, BrowserPage> = new Map();
let currentPageId = 0;

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function fetchUrl(url: string): string {
  try {
    return execSync(
      `curl -sL -m 30 --max-filesize 5000000 -k "${url}"`,
      { encoding: "utf-8", timeout: 35000 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch ${url}: ${msg}`);
  }
}

function urlEncode(str: string): string {
  return encodeURIComponent(str).replace(/%20/g, "+");
}

async function toolWebfetch(args: Record<string, string>): Promise<ToolResult> {
  const url = args["url"] ?? "";
  if (url === "") {
    return { tool: "webfetch", success: false, output: "Missing url argument" };
  }

  try {
    const html = fetchUrl(url);
    const text = stripHtml(html);
    const page: BrowserPage = {
      title: url,
      url,
      content: text.slice(0, 50000),
    };
    currentPageId++;
    browserPages.set(currentPageId, page);
    return { tool: "webfetch", success: true, output: text.slice(0, 10000) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "webfetch", success: false, output: msg };
  }
}

async function toolWebsearch(
  args: Record<string, string>,
): Promise<ToolResult> {
  const query = args["query"] ?? "";
  if (query === "") {
    return { tool: "websearch", success: false, output: "Missing query argument" };
  }

  try {
    const encoded = urlEncode(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
    const html = fetchUrl(url);

    const results: string[] = [];
    const linkRegex =
      /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

    let match;
    let idx = 0;
    while ((match = linkRegex.exec(html)) !== null && idx < 10) {
      const href = match[1] ?? "";
      const title = stripHtml(match[2] ?? "");
      if (title !== "" && href !== "") {
        results.push(`[${String(idx)}] ${title}\n    ${href}`);
        idx++;
      }
    }

    if (results.length === 0) {
      return {
        tool: "websearch",
        success: true,
        output: "No results found",
      };
    }

    return {
      tool: "websearch",
      success: true,
      output: results.join("\n\n"),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "websearch", success: false, output: msg };
  }
}

async function toolWebopen(args: Record<string, string>): Promise<ToolResult> {
  const target = args["url"] ?? args["id"] ?? "";
  if (target === "") {
    return { tool: "webopen", success: false, output: "Missing url or id argument" };
  }

  let url: string;
  const idNum = parseInt(target, 10);
  if (!isNaN(idNum)) {
    const page = browserPages.get(idNum);
    if (page === undefined) {
      return { tool: "webopen", success: false, output: `Page ${target} not found` };
    }
    url = page.url;
  } else {
    url = target;
  }

  try {
    const html = fetchUrl(url);
    const text = stripHtml(html);
    const page: BrowserPage = {
      title: url,
      url,
      content: text.slice(0, 50000),
    };
    currentPageId++;
    browserPages.set(currentPageId, page);
    return {
      tool: "webopen",
      success: true,
      output: `Opened [${String(currentPageId)}]: ${url}\n\n${text.slice(0, 5000)}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "webopen", success: false, output: msg };
  }
}

async function toolWebfind(args: Record<string, string>): Promise<ToolResult> {
  const pattern = args["pattern"] ?? "";
  if (pattern === "") {
    return { tool: "webfind", success: false, output: "Missing pattern argument" };
  }

  const pageId = args["page_id"] !== undefined
    ? parseInt(args["page_id"], 10)
    : currentPageId;

  const page = browserPages.get(pageId);
  if (page === undefined) {
    return { tool: "webfind", success: false, output: "No page loaded" };
  }

  try {
    const regex = new RegExp(pattern, "gi");
    const lines = page.content.split(/[.!?\n]+/);
    const matches: string[] = [];

    for (const line of lines) {
      if (regex.test(line.trim())) {
        matches.push(line.trim());
        regex.lastIndex = 0;
      }
    }

    if (matches.length === 0) {
      return { tool: "webfind", success: true, output: "No matches found" };
    }

    return {
      tool: "webfind",
      success: true,
      output: matches.slice(0, 20).join("\n"),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tool: "webfind", success: false, output: msg };
  }
}

export const webTools: LocalTool[] = [
  {
    name: "websearch",
    description: "Search the web using DuckDuckGo",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    permissionLevel: "safe",
    handler: toolWebsearch,
  },
  {
    name: "webopen",
    description: "Open a webpage or search result by URL or ID",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL or result ID to open" },
      },
      required: ["url"],
    },
    permissionLevel: "safe",
    handler: toolWebopen,
  },
  {
    name: "webfind",
    description: "Search text within an opened webpage",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Pattern to search for" },
      },
      required: ["pattern"],
    },
    permissionLevel: "safe",
    handler: toolWebfind,
  },
  {
    name: "webfetch",
    description: "Fetch and return webpage content",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
      },
      required: ["url"],
    },
    permissionLevel: "safe",
    handler: toolWebfetch,
  },
];
