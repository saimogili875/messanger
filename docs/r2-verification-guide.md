# Cloudflare R2 Integration & Verification Guide

This guide provides a manual step-by-step checklist to test presigned multipart uploads, signed download URLs, and CORS configuration with a real Cloudflare R2 bucket.

---

## 1. Cloudflare R2 Bucket Configuration

### A. Bucket CORS Configuration
In the Cloudflare Dashboard, navigate to **R2 > [Your Bucket] > Settings > CORS Policy** and paste the following configuration:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:3000"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "POST",
      "DELETE",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag",
      "Content-Type",
      "Content-Length"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

### B. Environment Variables in `.env`
Update your `.env` with your real Cloudflare R2 API credentials:

```bash
R2_ACCOUNT_ID="your_real_cloudflare_account_id"
R2_ACCESS_KEY_ID="your_real_r2_access_key_id"
R2_SECRET_ACCESS_KEY="your_real_r2_secret_access_key"
R2_BUCKET_NAME="messenger-media"
R2_ENDPOINT="https://<your_account_id>.r2.cloudflarestorage.com"
```

---

## 2. Step-by-Step Verification Checklist

### Step 1: Initiate File Upload (`/files/init`)
Request presigned upload URLs from the backend API:

```bash
# 1. Login to get an access token
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"Password123!"}' | jq -r .accessToken)

# 2. Initiate an image upload (e.g. 5 MB)
INIT_RES=$(curl -s -X POST http://127.0.0.1:3000/files/init \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "test-photo.jpg",
    "mimeType": "image/jpeg",
    "sizeBytes": 5242880,
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }')

FILE_ID=$(echo $INIT_RES | jq -r .fileId)
PUT_URL=$(echo $INIT_RES | jq -r .uploadUrl)
echo "File ID: $FILE_ID"
echo "Presigned URL: $PUT_URL"
```

### Step 2: Upload File Directly to Cloudflare R2
Upload the actual binary data directly from the client to Cloudflare R2 using `PUT`:

```bash
curl -i -X PUT "$PUT_URL" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@test-photo.jpg"
```

**Expected Result**:
- `HTTP/1.1 200 OK`
- ETag header returned by Cloudflare R2.
- The API server never carried the raw file bytes.

### Step 3: Complete the Upload (`/files/complete`)
Notify the backend API that the upload has finished to trigger worker processing:

```bash
curl -i -X POST http://127.0.0.1:3000/files/complete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"fileId\":\"$FILE_ID\"}"
```

**Expected Result**:
- `HTTP/1.1 200 OK` with status `"processing"`.

### Step 4: Verify Worker Status & Signed Download URL
Poll the file record until status transitions to `"ready"`:

```bash
curl -s -X GET http://127.0.0.1:3000/files/$FILE_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Once `"status": "ready"`, test the signed download route:

```bash
DOWNLOAD_RES=$(curl -s -X GET http://127.0.0.1:3000/files/$FILE_ID/download \
  -H "Authorization: Bearer $TOKEN")

DOWNLOAD_URL=$(echo $DOWNLOAD_RES | jq -r .downloadUrl)
echo "Download URL (expires in 5m): $DOWNLOAD_URL"

# Test fetching the file using the signed URL
curl -I "$DOWNLOAD_URL"
```

**Expected Result**:
- `HTTP/1.1 200 OK`
- `Content-Disposition: attachment; filename="test-photo.jpg"` (or inline for previewable formats).
- URL contains `X-Amz-Expires=300`.
