#!/usr/bin/env bash
# scripts/e2e.sh
# End-to-end integration test validating authentication, token lifecycle, and security controls.

set -e

BASE_URL="${API_URL:-http://localhost:3000}"
TIMESTAMP=$(date +%s)
EMAIL="test_${TIMESTAMP}@example.com"
PASSWORD="SecurePassword123!"
DISPLAY_NAME="Tester ${TIMESTAMP}"

FAILED=0

# Helper functions for colored test output
pass() {
  echo "  [PASS] $1"
}

fail() {
  echo "  [FAIL] $1"
  FAILED=1
}

echo "=== Messenger API Phase 1 E2E Tests ==="
echo "Target: $BASE_URL"

# 1. Register a user with a unique email
echo "Test 1: Register new user..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"$DISPLAY_NAME\"}")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" -eq 201 ]; then
  pass "Registration returned 201 Created"
else
  fail "Expected 201 but got $HTTP_CODE: $BODY"
fi

# 2. Register with the same email again -> expect 409
echo "Test 2: Duplicate registration..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"$DISPLAY_NAME\"}")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" -eq 409 ]; then
  pass "Duplicate email returned 409 Conflict"
else
  fail "Expected 409 but got $HTTP_CODE: $BODY"
fi

# 3. Login with wrong password -> expect 401
echo "Test 3: Login with wrong password..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"WrongPassword999!\"}")
HTTP_CODE=$(echo "$RESP" | tail -n 1)

if [ "$HTTP_CODE" -eq 401 ]; then
  pass "Wrong password returned 401 Unauthorized"
else
  fail "Expected 401 but got $HTTP_CODE"
fi

# 4. Login correctly -> save accessToken and refreshToken
echo "Test 4: Login with correct credentials..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
  ACCESS_TOKEN=$(node -e "console.log(JSON.parse(process.argv[1]).accessToken || '')" "$BODY")
  REFRESH_TOKEN=$(node -e "console.log(JSON.parse(process.argv[1]).refreshToken || '')" "$BODY")
  if [ -n "$ACCESS_TOKEN" ] && [ -n "$REFRESH_TOKEN" ]; then
    pass "Login returned 200 with accessToken and refreshToken"
  else
    fail "Login response missing tokens: $BODY"
  fi
else
  fail "Expected 200 but got $HTTP_CODE: $BODY"
fi

# 5. GET /me without token -> expect 401
echo "Test 5: GET /me without Authorization header..."
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/me")
HTTP_CODE=$(echo "$RESP" | tail -n 1)

if [ "$HTTP_CODE" -eq 401 ]; then
  pass "Unauthenticated request returned 401 Unauthorized"
else
  fail "Expected 401 but got $HTTP_CODE"
fi

# 6. GET /me with the access token -> expect 200
echo "Test 6: GET /me with valid access token..."
RESP=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
  ME_EMAIL=$(node -e "console.log(JSON.parse(process.argv[1]).email || '')" "$BODY")
  if [ "$ME_EMAIL" = "$EMAIL" ]; then
    pass "GET /me returned 200 with matching user profile"
  else
    fail "GET /me email mismatch. Expected $EMAIL, got $ME_EMAIL"
  fi
else
  fail "Expected 200 but got $HTTP_CODE: $BODY"
fi

# 7. Refresh token rotation
echo "Test 7: Rotate refresh token..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
HTTP_CODE=$(echo "$RESP" | tail -n 1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
  NEW_ACCESS_TOKEN=$(node -e "console.log(JSON.parse(process.argv[1]).accessToken || '')" "$BODY")
  NEW_REFRESH_TOKEN=$(node -e "console.log(JSON.parse(process.argv[1]).refreshToken || '')" "$BODY")
  pass "Refresh endpoint returned 200 with new tokens"
else
  fail "Expected 200 but got $HTTP_CODE: $BODY"
fi

echo "Test 7b: Confirm OLD refresh token is revoked..."
OLD_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}")
OLD_HTTP_CODE=$(echo "$OLD_RESP" | tail -n 1)

if [ "$OLD_HTTP_CODE" -eq 401 ]; then
  pass "Old refresh token rejected with 401 Unauthorized"
else
  fail "Expected old refresh token to fail with 401, got $OLD_HTTP_CODE"
fi

# 8. Logout with new refresh token -> expect 204; then refresh with it -> expect 401
echo "Test 8: Logout with active refresh token..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/logout" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$NEW_REFRESH_TOKEN\"}")
HTTP_CODE=$(echo "$RESP" | tail -n 1)

if [ "$HTTP_CODE" -eq 204 ]; then
  pass "Logout returned 204 No Content"
else
  fail "Expected 204 but got $HTTP_CODE"
fi

echo "Test 8b: Refresh with logged-out token -> expect 401..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$NEW_REFRESH_TOKEN\"}")
HTTP_CODE=$(echo "$RESP" | tail -n 1)

if [ "$HTTP_CODE" -eq 401 ]; then
  pass "Logged-out refresh token rejected with 401 Unauthorized"
else
  fail "Expected 401 but got $HTTP_CODE"
fi

# 9. Hit /auth/login 6 times quickly -> expect 429 rate limit
echo "Test 9: Rate limiting on /auth/login..."
GOT_429=0
for i in {1..6}; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"rate@limit.com\",\"password\":\"wrong\"}")
  if [ "$STATUS" -eq 429 ]; then
    GOT_429=1
    break
  fi
done

if [ "$GOT_429" -eq 1 ]; then
  pass "Rate limit triggered with 429 Too Many Requests"
else
  fail "Expected 429 rate limit within 6 attempts"
fi

echo "=========================================="
if [ "$FAILED" -eq 0 ]; then
  echo "All E2E tests PASSED! 🎉"
  exit 0
else
  echo "Some E2E tests FAILED!"
  exit 1
fi
