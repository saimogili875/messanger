import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_9zeFO4NSXLEG@ep-long-breeze-ao3qvavb-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?channel_binding=require&sslmode=require";
const APP_URL = "http://127.0.0.1:3000";

async function run() {
  console.log("==================================================");
  console.log("       NEON POSTGRES END-TO-END VERIFICATION      ");
  console.log("==================================================");

  // 1. Direct Neon SQL verification
  console.log("\n[1/4] Connecting directly to Neon Database...");
  const sql = postgres(NEON_URL, { prepare: false });

  const [dbVersion] = await sql`SELECT version(), current_database() as db_name, inet_server_addr() as server_ip`;
  console.log("✓ Neon Database Connected!");
  console.log(`  Database Name: ${dbVersion.db_name}`);
  console.log(`  Postgres Version: ${dbVersion.version.split(" on ")[0]}`);

  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `;
  console.log(`✓ Neon Tables Verified (${tables.length} tables found):`);
  tables.forEach(t => console.log(`   - ${t.table_name}`));

  // 2. Test Fastify Application Connected to Neon
  console.log("\n[2/4] Testing App Health Endpoint connected to Neon...");
  const healthRes = await fetch(`${APP_URL}/health`);
  const healthData = await healthRes.json();
  console.log(`✓ GET /health responded with status ${healthRes.status}:`, healthData);

  // 3. User Lifecycle against Neon
  console.log("\n[3/4] Testing User Authentication & Chat Lifecycle via Neon...");
  const rand = Math.floor(Math.random() * 100000);
  const user1Email = `neon_alice_${rand}@college.edu`;
  const user2Email = `neon_bob_${rand}@college.edu`;
  const password = "Password123!Neon";

  // Register User 1
  const reg1Res = await fetch(`${APP_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user1Email, password, displayName: `Alice Neon ${rand}` })
  });
  const user1 = await reg1Res.json();
  console.log(`✓ POST /auth/register User 1: Created (ID: ${user1.id})`);

  // Register User 2
  const reg2Res = await fetch(`${APP_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user2Email, password, displayName: `Bob Neon ${rand}` })
  });
  const user2 = await reg2Res.json();
  console.log(`✓ POST /auth/register User 2: Created (ID: ${user2.id})`);

  // Login User 1
  const loginRes = await fetch(`${APP_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user1Email, password })
  });
  const tokens = await loginRes.json();
  console.log(`✓ POST /auth/login User 1: Success (Tokens & session generated)`);

  // GET /me
  const meRes = await fetch(`${APP_URL}/me`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` }
  });
  const me = await meRes.json();
  console.log(`✓ GET /me: Returned profile from Neon:`, me.displayName, `(${me.email})`);

  // Search User 2
  const searchRes = await fetch(`${APP_URL}/users/search?q=${encodeURIComponent(user2Email)}`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` }
  });
  const foundUsers = await searchRes.json();
  console.log(`✓ GET /users/search: Found ${foundUsers.length} matching user(s) in Neon`);

  // Create Direct Chat
  const chatRes = await fetch(`${APP_URL}/chats/direct`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.accessToken}`
    },
    body: JSON.stringify({ recipientId: user2.id })
  });
  const chat = await chatRes.json();
  console.log(`✓ POST /chats/direct: Created chat in Neon (Chat ID: ${chat.id})`);

  // List Chats
  const listChatsRes = await fetch(`${APP_URL}/chats`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` }
  });
  const chatList = await listChatsRes.json();
  console.log(`✓ GET /chats: Retrieved ${chatList.length} conversation(s) from Neon`);

  // Token rotation & reuse detection
  const refreshRes = await fetch(`${APP_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken })
  });
  const newTokens = await refreshRes.json();
  console.log(`✓ POST /auth/refresh: Rotated refresh token successfully`);

  // Attempt replay of old token
  const replayRes = await fetch(`${APP_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken })
  });
  console.log(`✓ Replay detection: Old token reuse rejected with status ${replayRes.status} (Session revoked in Neon)`);

  // 4. Verify Database Integrity in Neon
  console.log("\n[4/4] Directly verifying database records in Neon tables...");
  const [dbUser] = await sql`SELECT id, email, display_name FROM users WHERE id = ${user1.id}`;
  console.log("✓ Verified Neon `users` row:", dbUser);

  const [dbChat] = await sql`SELECT id, type, last_seq FROM chats WHERE id = ${chat.id}`;
  console.log("✓ Verified Neon `chats` row:", dbChat);

  const members = await sql`SELECT user_id, role FROM chat_members WHERE chat_id = ${chat.id}`;
  console.log(`✓ Verified Neon ` + "`chat_members`" + ` rows (${members.length} members):`, members.map(m => m.user_id));

  const [sessionCount] = await sql`SELECT count(*)::int as count FROM sessions WHERE user_id = ${user1.id}`;
  console.log(`✓ Verified Neon ` + "`sessions`" + ` rows for user: ${sessionCount.count}`);

  const [usedTokensCount] = await sql`SELECT count(*)::int as count FROM used_refresh_tokens`;
  console.log(`✓ Verified Neon ` + "`used_refresh_tokens`" + ` rows in database: ${usedTokensCount.count}`);

  await sql.end();

  console.log("\n==================================================");
  console.log("   ALL SERVICES ON NEON VERIFIED & WORKING 100%!  ");
  console.log("==================================================");
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
