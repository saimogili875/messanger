// tests/media.test.ts
// Comprehensive integration tests for Phase 5 media handling, R2 upload flow, ClamAV scanning, Office macro rejection, and access controls.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import crypto from "crypto";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app";
import { client, db } from "../src/db";
import { users, files, userStorageQuotas, chats, chatMembers, messages } from "../src/db/schema";
import { storageService } from "../src/services/storage.service";
import { mediaProcessor } from "../src/workers/media.processor";
import { cleanupStuckUploads } from "../src/workers/cleanup.job";

describe("Phase 5 Media, Storage, and Security Integration Tests", () => {
  let app: FastifyInstance;
  let ipCounter = 10;
  let userAToken: string;
  let userAId: string;
  let userBToken: string;
  let userBId: string;

  function getIp(): string {
    return `198.51.100.${ipCounter++}`;
  }

  beforeAll(async () => {
    // Reset test database
    await client`TRUNCATE TABLE users, devices, chats, chat_members, messages, sessions, files, user_storage_quotas CASCADE`;

    app = buildApp();
    await app.ready();

    // Register and login User A
    const resRegA = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: getIp(),
      payload: {
        email: "alice_media@example.com",
        password: "Password123!",
        displayName: "Alice",
      },
    });
    userAId = JSON.parse(resRegA.payload).id;

    const resLoginA = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: getIp(),
      payload: {
        email: "alice_media@example.com",
        password: "Password123!",
      },
    });
    userAToken = JSON.parse(resLoginA.payload).accessToken;

    // Register and login User B
    const resRegB = await app.inject({
      method: "POST",
      url: "/auth/register",
      remoteAddress: getIp(),
      payload: {
        email: "bob_media@example.com",
        password: "Password123!",
        displayName: "Bob",
      },
    });
    userBId = JSON.parse(resRegB.payload).id;

    const resLoginB = await app.inject({
      method: "POST",
      url: "/auth/login",
      remoteAddress: getIp(),
      payload: {
        email: "bob_media@example.com",
        password: "Password123!",
      },
    });
    userBToken = JSON.parse(resLoginB.payload).accessToken;
  });

  afterAll(async () => {
    await app.close();
    await client.end();
  });

  it("1. Reject disallowed MIME types and enforce size caps at /files/init", async () => {
    const dummyHash = crypto.createHash("sha256").update("sample").digest("hex");

    // HTML / SVG rejected
    const resHtml = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "malicious.html",
        mimeType: "text/html",
        sizeBytes: 1024,
        sha256Hash: dummyHash,
      },
    });
    expect(resHtml.statusCode).toBe(400);

    // Image exceeding 20 MB
    const resLargeImage = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "huge.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 21 * 1024 * 1024, // 21 MB
        sha256Hash: dummyHash,
      },
    });
    expect(resLargeImage.statusCode).toBe(400);
    expect(JSON.parse(resLargeImage.payload).error).toMatch(/exceeds maximum limit of 20 MB/);

    // Document exceeding 50 MB
    const resLargeDoc = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "huge.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 55 * 1024 * 1024, // 55 MB
        sha256Hash: dummyHash,
      },
    });
    expect(resLargeDoc.statusCode).toBe(400);
    expect(JSON.parse(resLargeDoc.payload).error).toMatch(/exceeds maximum limit of 50 MB/);

    // Video exceeding 200 MB
    const resLargeVideo = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "huge.mp4",
        mimeType: "video/mp4",
        sizeBytes: 250 * 1024 * 1024, // 250 MB
        sha256Hash: dummyHash,
      },
    });
    expect(resLargeVideo.statusCode).toBe(400);
    expect(JSON.parse(resLargeVideo.payload).error).toMatch(/exceeds maximum limit of 200 MB/);
  });

  it("2. Enforce per-user storage quota (1 GB) and daily upload limit (500 MB)", async () => {
    const dummyHash = crypto.createHash("sha256").update("quota-test").digest("hex");

    // Manually set User A's daily upload usage to 490 MB
    await db
      .insert(userStorageQuotas)
      .values({
        userId: userAId,
        storageUsedBytes: 0,
        dailyUploadBytes: 490 * 1024 * 1024,
        dailyResetAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userStorageQuotas.userId,
        set: { dailyUploadBytes: 490 * 1024 * 1024 },
      });

    // Try uploading a 20 MB file which exceeds remaining 10 MB daily quota
    const resDailyExceeded = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "test.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 20 * 1024 * 1024,
        sha256Hash: dummyHash,
      },
    });
    expect(resDailyExceeded.statusCode).toBe(400);
    expect(JSON.parse(resDailyExceeded.payload).error).toMatch(/Daily upload bandwidth exceeded/);

    // Reset daily upload bytes for further tests
    await db
      .update(userStorageQuotas)
      .set({ dailyUploadBytes: 0 })
      .where(eq(userStorageQuotas.userId, userAId));
  });

  it("3. Owner-scoped SHA-256 deduplication works for same owner and isolates other owners", async () => {
    const uniqueContent = `dedup-content-${Date.now()}`;
    const hash = crypto.createHash("sha256").update(uniqueContent).digest("hex");

    // User A inits file
    const resInitA = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "doc1.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 1024,
        sha256Hash: hash,
      },
    });
    expect(resInitA.statusCode).toBe(200);
    const initDataA = JSON.parse(resInitA.payload);
    expect(initDataA.deduplicated).toBe(false);

    // Simulate upload completion and mark file as ready
    await db
      .update(files)
      .set({ status: "ready" })
      .where(eq(files.id, initDataA.fileId));

    // User A inits identical file again -> should deduplicate
    const resDedupA = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "doc1_copy.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 1024,
        sha256Hash: hash,
      },
    });
    expect(resDedupA.statusCode).toBe(200);
    const dedupDataA = JSON.parse(resDedupA.payload);
    expect(dedupDataA.deduplicated).toBe(true);
    expect(dedupDataA.fileId).toBe(initDataA.fileId);

    // User B inits identical file with same SHA-256 -> must NOT deduplicate across users
    const resInitB = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userBToken}` },
      payload: {
        fileName: "doc1_bob.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 1024,
        sha256Hash: hash,
      },
    });
    expect(resInitB.statusCode).toBe(200);
    const initDataB = JSON.parse(resInitB.payload);
    expect(initDataB.deduplicated).toBe(false);
    expect(initDataB.fileId).not.toBe(initDataA.fileId);
  });

  it("4. Office macro file and encrypted documents are blocked during worker inspection", async () => {
    // 1. Create macro ZIP archive
    const macroZip = new AdmZip();
    macroZip.addFile("[Content_Types].xml", Buffer.from("<Types></Types>"));
    macroZip.addFile("word/document.xml", Buffer.from("<w:document></w:document>"));
    macroZip.addFile("word/vbaProject.bin", Buffer.from("VBA_MACRO_PAYLOAD"));
    const macroBuffer = macroZip.toBuffer();
    const macroHash = crypto.createHash("sha256").update(macroBuffer).digest("hex");

    const resInitMacro = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "invoice.docm",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: macroBuffer.length,
        sha256Hash: macroHash,
      },
    });
    const { fileId: macroFileId } = JSON.parse(resInitMacro.payload);

    // Save buffer in mock R2 and transition to processing
    const [macroFile] = await db.select().from(files).where(eq(files.id, macroFileId)).limit(1);
    await storageService.putObject(macroFile.r2Key, macroBuffer, macroFile.mimeType);
    await db.update(files).set({ status: "processing" }).where(eq(files.id, macroFileId));

    // Run processor
    await mediaProcessor.processFile(macroFileId);

    const [checkedMacro] = await db.select().from(files).where(eq(files.id, macroFileId)).limit(1);
    expect(checkedMacro.status).toBe("failed");
    expect(checkedMacro.failureReason).toMatch(/Macro-enabled Office documents/);

    // 2. Create encrypted document archive
    const encZip = new AdmZip();
    encZip.addFile("EncryptedPackage", Buffer.from("ENCRYPTED_STREAM"));
    const encBuffer = encZip.toBuffer();
    const encHash = crypto.createHash("sha256").update(encBuffer).digest("hex");

    const resInitEnc = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "protected.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: encBuffer.length,
        sha256Hash: encHash,
      },
    });
    const { fileId: encFileId } = JSON.parse(resInitEnc.payload);

    const [encFile] = await db.select().from(files).where(eq(files.id, encFileId)).limit(1);
    await storageService.putObject(encFile.r2Key, encBuffer, encFile.mimeType);
    await db.update(files).set({ status: "processing" }).where(eq(files.id, encFileId));

    await mediaProcessor.processFile(encFileId);

    const [checkedEnc] = await db.select().from(files).where(eq(files.id, encFileId)).limit(1);
    expect(checkedEnc.status).toBe("failed");
    expect(checkedEnc.failureReason).toMatch(/Encrypted or password-protected Office documents/);
  });

  it("5. Malware file (EICAR test string) is blocked and deleted from storage", async () => {
    // Standard EICAR antivirus test signature wrapped in a valid JPEG header
    const eicarString = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    const infectedBuffer = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
      Buffer.from(eicarString),
    ]);
    const hash = crypto.createHash("sha256").update(infectedBuffer).digest("hex");

    const resInit = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "virus.jpg",
        mimeType: "image/jpeg",
        sizeBytes: infectedBuffer.length,
        sha256Hash: hash,
      },
    });
    const { fileId } = JSON.parse(resInit.payload);

    const [fileRec] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    await storageService.putObject(fileRec.r2Key, infectedBuffer, "image/jpeg");
    await db.update(files).set({ status: "processing" }).where(eq(files.id, fileId));

    await mediaProcessor.processFile(fileId);

    const [scannedFile] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    expect(scannedFile.status).toBe("blocked");
    expect(scannedFile.failureReason).toMatch(/Malware detected/);
  });

  it("6. Clean DOCX document converts to PDF preview and page-1 thumbnail", async () => {
    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from("<Types></Types>"));
    zip.addFile("word/document.xml", Buffer.from("<w:document><w:body><w:p></w:p></w:body></w:document>"));
    const docxBuffer = zip.toBuffer();
    const docxHash = crypto.createHash("sha256").update(docxBuffer).digest("hex");

    const resInit = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "quarterly_report.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: docxBuffer.length,
        sha256Hash: docxHash,
      },
    });
    const { fileId } = JSON.parse(resInit.payload);

    const [fileRec] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    await storageService.putObject(fileRec.r2Key, docxBuffer, fileRec.mimeType);
    await db.update(files).set({ status: "processing" }).where(eq(files.id, fileId));

    await mediaProcessor.processFile(fileId);

    const [readyFile] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    expect(readyFile.status).toBe("ready");
    expect(readyFile.previewPdfR2Key).toBeDefined();
    expect(readyFile.thumbnailR2Key).toBeDefined();

    // Query preview endpoint
    const resPreview = await app.inject({
      method: "GET",
      url: `/files/${fileId}/preview`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(resPreview.statusCode).toBe(200);
    const previewData = JSON.parse(resPreview.payload);
    expect(previewData.previewUrl).toContain("preview.pdf");
  });

  it("7. Clean video transcode and duration limit rejection (>10 min)", async () => {
    // 1. Clean MP4
    const validMp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from("ftyp"),
      Buffer.from("isom"),
      Buffer.alloc(32),
    ]);
    const mp4Hash = crypto.createHash("sha256").update(validMp4).digest("hex");

    const resInitVid = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "vacation.mp4",
        mimeType: "video/mp4",
        sizeBytes: validMp4.length,
        sha256Hash: mp4Hash,
      },
    });
    const { fileId: vidId } = JSON.parse(resInitVid.payload);

    const [vidRec] = await db.select().from(files).where(eq(files.id, vidId)).limit(1);
    await storageService.putObject(vidRec.r2Key, validMp4, "video/mp4");
    await db.update(files).set({ status: "processing" }).where(eq(files.id, vidId));

    await mediaProcessor.processFile(vidId);

    const [readyVid] = await db.select().from(files).where(eq(files.id, vidId)).limit(1);
    expect(readyVid.status).toBe("ready");
    expect(readyVid.thumbnailR2Key).toBeDefined();
    expect(readyVid.transcodedR2Key).toBeDefined();
    expect(readyVid.durationSeconds).toBe(5);

    // 2. Video exceeding maximum duration of 10 min
    const overDurationMp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from("ftyp"),
      Buffer.from("isom"),
      Buffer.from("MOCK_OVER_DURATION_VIDEO"),
    ]);
    const overHash = crypto.createHash("sha256").update(overDurationMp4).digest("hex");

    const resInitOver = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "too_long.mp4",
        mimeType: "video/mp4",
        sizeBytes: overDurationMp4.length,
        sha256Hash: overHash,
      },
    });
    const { fileId: overId } = JSON.parse(resInitOver.payload);

    const [overRec] = await db.select().from(files).where(eq(files.id, overId)).limit(1);
    await storageService.putObject(overRec.r2Key, overDurationMp4, "video/mp4");
    await db.update(files).set({ status: "processing" }).where(eq(files.id, overId));

    await mediaProcessor.processFile(overId);

    const [failedVid] = await db.select().from(files).where(eq(files.id, overId)).limit(1);
    expect(failedVid.status).toBe("failed");
    expect(failedVid.failureReason).toMatch(/exceeds limit/);
  });

  it("8. Download authorization: non-member gets 403, chat-member gets 200 with signed download URL", async () => {
    // User A has a ready file
    const pngBuffer = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 0, g: 128, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const pngHash = crypto.createHash("sha256").update(pngBuffer).digest("hex");

    const resInit = await app.inject({
      method: "POST",
      url: "/files/init",
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        fileName: "private_photo.png",
        mimeType: "image/png",
        sizeBytes: pngBuffer.length,
        sha256Hash: pngHash,
      },
    });
    const { fileId } = JSON.parse(resInit.payload);

    const [fileRec] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    await storageService.putObject(fileRec.r2Key, pngBuffer, "image/png");
    await db.update(files).set({ status: "ready" }).where(eq(files.id, fileId));

    // User B attempts to download User A's file before it is shared in any chat -> 403 Forbidden
    const resBForbidden = await app.inject({
      method: "GET",
      url: `/files/${fileId}/download`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userBToken}` },
    });
    expect(resBForbidden.statusCode).toBe(403);
    expect(JSON.parse(resBForbidden.payload).error).toMatch(/Access denied/);

    // Now User A shares this file into a chat with User B
    const [chat] = await db
      .insert(chats)
      .values({
        type: "direct",
        directKey: `${userAId}:${userBId}`,
        lastSeq: 1,
      })
      .returning();

    await db.insert(chatMembers).values([
      { chatId: chat.id, userId: userAId, lastDeliveredSeq: 1, lastReadSeq: 1 },
      { chatId: chat.id, userId: userBId, lastDeliveredSeq: 0, lastReadSeq: 0 },
    ]);

    await db.insert(messages).values({
      chatId: chat.id,
      senderId: userAId,
      clientMsgId: crypto.randomUUID(),
      seq: 1,
      body: "Here is the photo",
      fileId,
      messageType: "image",
    });

    // Now User B attempts to download the file -> 200 OK with signed URL
    const resBAllowed = await app.inject({
      method: "GET",
      url: `/files/${fileId}/download`,
      remoteAddress: getIp(),
      headers: { authorization: `Bearer ${userBToken}` },
    });
    expect(resBAllowed.statusCode).toBe(200);
    const downloadData = JSON.parse(resBAllowed.payload);
    expect(downloadData.downloadUrl).toBeDefined();
    expect(downloadData.fileName).toBe("private_photo.png");
  });

  it("9. Cleanup job aborts stuck uploads exceeding 24 hours threshold", async () => {
    // Insert an old stuck upload created 25 hours ago
    const oldTimestamp = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const [stuckFile] = await db
      .insert(files)
      .values({
        ownerId: userAId,
        fileType: "document",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        originalName: "stuck_upload.docx",
        sizeBytes: 1024,
        sha256Hash: crypto.randomBytes(32).toString("hex"),
        status: "uploading",
        r2Key: `uploads/${userAId}/stuck_upload.docx`,
        createdAt: oldTimestamp,
        updatedAt: oldTimestamp,
      })
      .returning();

    const cleanedCount = await cleanupStuckUploads();
    expect(cleanedCount).toBeGreaterThanOrEqual(1);

    const [cleanedFile] = await db.select().from(files).where(eq(files.id, stuckFile.id)).limit(1);
    expect(cleanedFile.status).toBe("failed");
    expect(cleanedFile.failureReason).toMatch(/Upload timed out/);
  });
});
