// src/modules/search/search.provider.ts
// Pluggable search interface and PostgreSQL full-text search implementation using tsvector and websearch_to_tsquery.

import { sql } from "drizzle-orm";
import { db } from "../../db";
import { HttpError } from "../auth/auth.service";

export interface SearchResultItem {
  messageId: string;
  chatId: string;
  senderId: string;
  seq: number;
  createdAt: string;
  snippet: string;
}

export interface SearchPage {
  results: SearchResultItem[];
  nextCursor: string | null;
}

export interface SearchProvider {
  search(params: {
    userId: string;
    q: string;
    chatId?: string;
    cursor?: string;
    limit: number;
  }): Promise<SearchPage>;
}

export class PostgresSearchProvider implements SearchProvider {
  // Searches messages across user chats using PostgreSQL 'simple' dictionary (works for Telugu, Hindi, and English)
  async search(params: {
    userId: string;
    q: string;
    chatId?: string;
    cursor?: string;
    limit: number;
  }): Promise<SearchPage> {
    const { userId, q, chatId, cursor, limit } = params;

    let cursorTs: string | null = null;
    let cursorId: string | null = null;

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, "base64").toString("utf8");
        const [tsStr, idStr] = decoded.split("|");
        const parsedDate = new Date(tsStr);
        if (isNaN(parsedDate.getTime()) || !idStr) {
          throw new Error("Invalid cursor format");
        }
        cursorTs = parsedDate.toISOString();
        cursorId = idStr;
      } catch {
        throw new HttpError(400, "Invalid search cursor format");
      }
    }

    // Bound SQL parameters preventing injection
    const targetChatId = chatId || null;
    const fetchLimit = limit + 1;

    // Search query joining chat_members to strictly enforce first_visible_seq boundary and chat membership
    const rows = await db.execute<{
      id: string;
      chat_id: string;
      sender_id: string;
      seq: number;
      created_at: string;
      snippet: string;
    }>(sql`
      SELECT m.id, m.chat_id, m.sender_id, m.seq, m.created_at,
             ts_headline('simple', m.body, q,
               'MaxFragments=1,MaxWords=20,MinWords=5,StartSel=<<,StopSel=>>') AS snippet
      FROM messages m
      JOIN chat_members cm
        ON cm.chat_id = m.chat_id AND cm.user_id = ${userId}::uuid
       AND m.seq >= cm.first_visible_seq,
      websearch_to_tsquery('simple', ${q}) q
      WHERE m.type = 'user'
        AND m.search_vector @@ q
        AND (${targetChatId}::uuid IS NULL OR m.chat_id = ${targetChatId}::uuid)
        AND (${cursorTs}::timestamptz IS NULL
             OR (m.created_at, m.id) < (${cursorTs}::timestamptz, ${cursorId}::uuid))
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${fetchLimit}
    `);

    const resultRows = Array.from(rows);
    const hasMore = resultRows.length > limit;
    const pageItems = hasMore ? resultRows.slice(0, limit) : resultRows;

    let nextCursor: string | null = null;
    if (hasMore && pageItems.length > 0) {
      const lastItem = pageItems[pageItems.length - 1];
      const isoString = new Date(lastItem.created_at).toISOString();
      nextCursor = Buffer.from(`${isoString}|${lastItem.id}`).toString("base64");
    }

    // Security Notice: The snippet marks matches with << and >> and is NEVER HTML.
    // Clients must HTML-escape the snippet before rendering into browser DOM.
    const results: SearchResultItem[] = pageItems.map((r) => ({
      messageId: r.id,
      chatId: r.chat_id,
      senderId: r.sender_id,
      seq: Number(r.seq),
      createdAt: new Date(r.created_at).toISOString(),
      snippet: r.snippet,
    }));

    return {
      results,
      nextCursor,
    };
  }
}

// Single provider constant enabling seamless swap in Phase 8 for on-device local search
export const searchProvider: SearchProvider = new PostgresSearchProvider();

