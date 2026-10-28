# Phase 6 Notes & Codebase Audit (Step 0)

## Repository Audit Findings

### a) Realtime Library & Socket Authentication
- **Realtime Library**: Neither `socket.io` nor `ws` is currently installed in `package.json` or implemented in the server code. Only the protocol event contracts (`shared/protocol.ts` and `src/shared/protocol.ts`) were defined in Phase 2 Step 1 (`commit 0e16491`).
- **Socket Authentication**: No WebSocket server or socket middleware/handler exists in `src/server.ts` or `src/app.ts`. Fastify currently only serves HTTP REST endpoints (`/auth/*`, `/me`, `/health`, `/files/*`).

### b) Sequence Allocation Function (`last_seq = last_seq + 1 ... RETURNING`)
- **Status**: The `last_seq` column exists on the `chats` table (`src/db/schema.ts`), but no SQL function or repository method performing `UPDATE chats SET last_seq = last_seq + 1 ... RETURNING` is currently implemented in the codebase.

### c) Rooms (`chat:<chatId>` and `user:<userId>`)
- **Status**: Since no socket server is currently initialized, neither room exists in code yet.

### d) Files Reading Messages for a User
- **Status**: No message query endpoints or services exist yet. `messages` table is defined in `src/db/schema.ts` and referenced in `files.service.ts` for chat access checks, but history retrieval, `sync:request`, and afterSeq queries have not been written.

### e) "List My Chats" Query / Endpoint
- **Status**: No `GET /chats` or "list my chats" route or service method exists in the repository yet.

### f) Duplicate Protocol Files
- **Status**: `shared/protocol.ts` and `src/shared/protocol.ts` are duplicates. `src/shared/protocol.ts` should be kept as the canonical copy, and any external references should import from `src/shared/protocol.ts`.

---

## Conclusion
Live chat implementation (`socket.io`/`ws`, socket auth, seq allocation, room management, receipts, message history, and sync) has not yet been built in this repo.
As specified in Step 0:
> "If live chat (ack + seq + receipts) is missing or tests fail, STOP and tell me."
Stopping here to notify the user.

