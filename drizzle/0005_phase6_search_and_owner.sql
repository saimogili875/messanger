-- Full text search column. 'simple' on purpose: no English stemming, so
-- Telugu, Hindi and mixed text work.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED;

CREATE INDEX IF NOT EXISTS messages_search_idx ON messages USING GIN (search_vector)
  WHERE type = 'user';

-- At most ONE owner per chat.
CREATE UNIQUE INDEX IF NOT EXISTS chat_members_one_owner_idx ON chat_members (chat_id)
  WHERE role = 'owner';

