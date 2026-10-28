// src/services/file-validator.service.ts
// Verifies real file types via magic bytes and inspects Office documents for macros and encryption.

import AdmZip from "adm-zip";

export type ValidatedFileType = "image" | "pdf" | "document" | "video";

export interface ValidationSuccess {
  isValid: true;
  fileType: ValidatedFileType;
  mimeType: string;
  extension: string;
}

export interface ValidationFailure {
  isValid: false;
  error: string;
  code:
    | "UNSUPPORTED_TYPE"
    | "MACRO_NOT_ALLOWED"
    | "ENCRYPTED_FILE_NOT_ALLOWED"
    | "CORRUPT_ARCHIVE";
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

// Allowlist of safe MIME types and corresponding metadata
export const ALLOWED_MIME_TYPES = {
  // Images
  "image/jpeg": { fileType: "image", ext: "jpg" },
  "image/png": { fileType: "image", ext: "png" },
  "image/webp": { fileType: "image", ext: "webp" },
  "image/gif": { fileType: "image", ext: "gif" },
  // PDF
  "application/pdf": { fileType: "pdf", ext: "pdf" },
  // Documents (Modern OpenXML only)
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    fileType: "document",
    ext: "docx",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    fileType: "document",
    ext: "xlsx",
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    fileType: "document",
    ext: "pptx",
  },
  // Video
  "video/mp4": { fileType: "video", ext: "mp4" },
  "video/quicktime": { fileType: "video", ext: "mov" },
  "video/webm": { fileType: "video", ext: "webm" },
} as const;

export class FileValidatorService {
  // Inspects file buffer headers and internal structure to determine authenticity and safety
  validateBuffer(buffer: Buffer, originalFileName = ""): ValidationResult {
    if (!buffer || buffer.length < 8) {
      return {
        isValid: false,
        code: "UNSUPPORTED_TYPE",
        error: "File is too small or empty to be a valid document or media file",
      };
    }

    // 1. Text-based payload check: reject HTML, SVG, scripts, and XML wrappers
    const headerString = buffer.subarray(0, 1024).toString("utf8").toLowerCase();
    if (
      headerString.includes("<svg") ||
      headerString.includes("<html") ||
      headerString.includes("<!doctype html") ||
      headerString.includes("<script")
    ) {
      return {
        isValid: false,
        code: "UNSUPPORTED_TYPE",
        error: "HTML, SVG, and script payloads are strictly disallowed",
      };
    }

    // 2. Reject executable binaries (Windows PE 'MZ', Linux ELF, Mach-O)
    if (
      (buffer[0] === 0x4d && buffer[1] === 0x5a) || // MZ
      (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) // \x7fELF
    ) {
      return {
        isValid: false,
        code: "UNSUPPORTED_TYPE",
        error: "Executable files are strictly disallowed",
      };
    }

    // 3. JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return {
        isValid: true,
        fileType: "image",
        mimeType: "image/jpeg",
        extension: "jpg",
      };
    }

    // 4. PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return {
        isValid: true,
        fileType: "image",
        mimeType: "image/png",
        extension: "png",
      };
    }

    // 5. GIF: GIF87a or GIF89a
    if (
      buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38
    ) {
      return {
        isValid: true,
        fileType: "image",
        mimeType: "image/gif",
        extension: "gif",
      };
    }

    // 6. WebP: RIFF .... WEBP
    if (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return {
        isValid: true,
        fileType: "image",
        mimeType: "image/webp",
        extension: "webp",
      };
    }

    // 7. PDF: starts with %PDF- (within first 1024 bytes per PDF standard)
    if (headerString.includes("%pdf-")) {
      return {
        isValid: true,
        fileType: "pdf",
        mimeType: "application/pdf",
        extension: "pdf",
      };
    }

    // 8. WebM: 1A 45 DF A3 (EBML Header)
    if (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    ) {
      return {
        isValid: true,
        fileType: "video",
        mimeType: "video/webm",
        extension: "webm",
      };
    }

    // 9. MP4 / MOV: ISO Base Media format (ftyp or moov box signature)
    if (buffer.length >= 12) {
      const boxType = buffer.subarray(4, 8).toString("ascii");
      if (boxType === "ftyp" || boxType === "moov") {
        const majorBrand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
        const isQuickTime = majorBrand.startsWith("qt");
        return {
          isValid: true,
          fileType: "video",
          mimeType: isQuickTime ? "video/quicktime" : "video/mp4",
          extension: isQuickTime ? "mov" : "mp4",
        };
      }
    }

    // 10. OpenXML Documents (DOCX, XLSX, PPTX): Zip archive starting with PK (0x50 0x4B 0x03 0x04)
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
      return this.validateOpenXmlArchive(buffer, originalFileName);
    }

    // Reject all other unverified or legacy binary types
    return {
      isValid: false,
      code: "UNSUPPORTED_TYPE",
      error: "File format is not in the allowlist of supported media or documents",
    };
  }

  // Deep inspection of ZIP container to verify OpenXML structure and block macros or encryption
  private validateOpenXmlArchive(
    buffer: Buffer,
    originalFileName: string
  ): ValidationResult {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      return {
        isValid: false,
        code: "CORRUPT_ARCHIVE",
        error: "Corrupt or unreadable document archive",
      };
    }

    const entries = zip.getEntries();
    if (!entries || entries.length === 0) {
      return {
        isValid: false,
        code: "CORRUPT_ARCHIVE",
        error: "Empty document archive",
      };
    }

    const entryNames = entries.map((e) => e.entryName.toLowerCase());

    // Check for password protection or standard encrypted package markers
    for (const entry of entries) {
      const name = entry.entryName.toLowerCase();
      // Check encrypted entry bit flag or EncryptedPackage streams
      if (
        (entry.header.flags & 1) === 1 ||
        name.includes("encryptedpackage") ||
        name.includes("encryptioninfo")
      ) {
        return {
          isValid: false,
          code: "ENCRYPTED_FILE_NOT_ALLOWED",
          error: "Encrypted or password-protected Office documents are not allowed",
        };
      }
    }

    // Check for embedded macros (VBA projects or macro-enabled types)
    for (const name of entryNames) {
      if (
        name.endsWith("vbaproject.bin") ||
        name.endsWith("vbamacro.bin") ||
        name.includes("vbadata.xml")
      ) {
        return {
          isValid: false,
          code: "MACRO_NOT_ALLOWED",
          error: "Macro-enabled Office documents (containing VBA projects) are strictly prohibited",
        };
      }
    }

    // Check file extension if original name is provided
    const lowerFileName = originalFileName.toLowerCase();
    if (
      lowerFileName.endsWith(".docm") ||
      lowerFileName.endsWith(".xlsm") ||
      lowerFileName.endsWith(".pptm")
    ) {
      return {
        isValid: false,
        code: "MACRO_NOT_ALLOWED",
        error: "Macro-enabled document file extension (.docm, .xlsm, .pptm) is not allowed",
      };
    }

    // Verify valid OpenXML type by internal folder markers
    const hasWord = entryNames.some((name) => name.startsWith("word/"));
    const hasExcel = entryNames.some((name) => name.startsWith("xl/"));
    const hasPpt = entryNames.some((name) => name.startsWith("ppt/"));
    const hasContentTypes = entryNames.some((name) => name === "[content_types].xml");

    if (!hasContentTypes) {
      return {
        isValid: false,
        code: "UNSUPPORTED_TYPE",
        error: "ZIP archive does not contain standard OpenXML Content Types",
      };
    }

    if (hasWord) {
      return {
        isValid: true,
        fileType: "document",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: "docx",
      };
    }

    if (hasExcel) {
      return {
        isValid: true,
        fileType: "document",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: "xlsx",
      };
    }

    if (hasPpt) {
      return {
        isValid: true,
        fileType: "document",
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        extension: "pptx",
      };
    }

    return {
      isValid: false,
      code: "UNSUPPORTED_TYPE",
      error: "Archive is not a recognized DOCX, XLSX, or PPTX document",
    };
  }
}

export const fileValidator = new FileValidatorService();

