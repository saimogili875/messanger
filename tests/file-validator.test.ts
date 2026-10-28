// tests/file-validator.test.ts
// Unit tests for magic bytes verification, format allowlisting, and macro/encryption rejection.

import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import { fileValidator } from "../src/services/file-validator.service";

describe("File Validator Service (Magic Bytes & Security)", () => {
  it("allows valid JPEG buffer", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const res = fileValidator.validateBuffer(jpeg, "photo.jpg");
    expect(res.isValid).toBe(true);
    if (res.isValid) {
      expect(res.mimeType).toBe("image/jpeg");
      expect(res.fileType).toBe("image");
    }
  });

  it("allows valid PNG buffer", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const res = fileValidator.validateBuffer(png, "image.png");
    expect(res.isValid).toBe(true);
    if (res.isValid) {
      expect(res.mimeType).toBe("image/png");
      expect(res.fileType).toBe("image");
    }
  });

  it("allows valid PDF buffer", () => {
    const pdf = Buffer.from("%PDF-1.7\n%some-pdf-content");
    const res = fileValidator.validateBuffer(pdf, "document.pdf");
    expect(res.isValid).toBe(true);
    if (res.isValid) {
      expect(res.mimeType).toBe("application/pdf");
      expect(res.fileType).toBe("pdf");
    }
  });

  it("allows valid MP4 buffer", () => {
    // 4 bytes length + 'ftyp' + 'isom'
    const mp4 = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x20]),
      Buffer.from("ftyp"),
      Buffer.from("isom"),
      Buffer.alloc(16),
    ]);
    const res = fileValidator.validateBuffer(mp4, "clip.mp4");
    expect(res.isValid).toBe(true);
    if (res.isValid) {
      expect(res.mimeType).toBe("video/mp4");
      expect(res.fileType).toBe("video");
    }
  });

  it("allows clean DOCX archive", () => {
    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from("<Types></Types>"));
    zip.addFile("word/document.xml", Buffer.from("<w:document></w:document>"));
    const docxBuffer = zip.toBuffer();

    const res = fileValidator.validateBuffer(docxBuffer, "report.docx");
    expect(res.isValid).toBe(true);
    if (res.isValid) {
      expect(res.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      expect(res.fileType).toBe("document");
    }
  });

  it("allows clean XLSX archive", () => {
    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from("<Types></Types>"));
    zip.addFile("xl/workbook.xml", Buffer.from("<workbook></workbook>"));
    const xlsxBuffer = zip.toBuffer();

    const res = fileValidator.validateBuffer(xlsxBuffer, "sheet.xlsx");
    expect(res.isValid).toBe(true);
    if (res.isValid) {
      expect(res.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      expect(res.fileType).toBe("document");
    }
  });

  it("allows clean PPTX archive", () => {
    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from("<Types></Types>"));
    zip.addFile("ppt/presentation.xml", Buffer.from("<presentation></presentation>"));
    const pptxBuffer = zip.toBuffer();

    const res = fileValidator.validateBuffer(pptxBuffer, "slides.pptx");
    expect(res.isValid).toBe(true);
    if (res.isValid) {
      expect(res.mimeType).toBe(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      );
      expect(res.fileType).toBe("document");
    }
  });

  it("rejects macro-enabled document containing vbaProject.bin", () => {
    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from("<Types></Types>"));
    zip.addFile("word/document.xml", Buffer.from("<w:document></w:document>"));
    zip.addFile("word/vbaProject.bin", Buffer.from("MALICIOUS_VBA_CODE"));
    const macroDocx = zip.toBuffer();

    const res = fileValidator.validateBuffer(macroDocx, "invoice.docx");
    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.code).toBe("MACRO_NOT_ALLOWED");
      expect(res.error).toContain("VBA");
    }
  });

  it("rejects macro file extension .docm", () => {
    const zip = new AdmZip();
    zip.addFile("[Content_Types].xml", Buffer.from("<Types></Types>"));
    zip.addFile("word/document.xml", Buffer.from("<w:document></w:document>"));
    const docm = zip.toBuffer();

    const res = fileValidator.validateBuffer(docm, "invoice.docm");
    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.code).toBe("MACRO_NOT_ALLOWED");
    }
  });

  it("rejects encrypted / password-protected Office document", () => {
    const zip = new AdmZip();
    zip.addFile("EncryptedPackage", Buffer.from("ENCRYPTED_STREAM_CONTENT"));
    const encryptedDoc = zip.toBuffer();

    const res = fileValidator.validateBuffer(encryptedDoc, "confidential.docx");
    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.code).toBe("ENCRYPTED_FILE_NOT_ALLOWED");
    }
  });

  it("rejects spoofed extension (HTML file masquerading as PNG)", () => {
    const htmlSpoof = Buffer.from("<!DOCTYPE html><html><body><h1>Fake PNG</h1></body></html>");
    const res = fileValidator.validateBuffer(htmlSpoof, "photo.png");
    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.code).toBe("UNSUPPORTED_TYPE");
    }
  });

  it("rejects SVG masquerading as document or image", () => {
    const svgSpoof = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    const res = fileValidator.validateBuffer(svgSpoof, "vector.png");
    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.code).toBe("UNSUPPORTED_TYPE");
    }
  });

  it("rejects executable file (Windows PE / MZ header)", () => {
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const res = fileValidator.validateBuffer(exe, "harmless.docx");
    expect(res.isValid).toBe(false);
    if (!res.isValid) {
      expect(res.code).toBe("UNSUPPORTED_TYPE");
      expect(res.error).toContain("Executable");
    }
  });
});

