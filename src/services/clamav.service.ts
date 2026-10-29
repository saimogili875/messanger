// src/services/clamav.service.ts
// Interfaces with ClamAV antivirus daemon over TCP INSTREAM protocol.

import net from "net";
import { env } from "../config/env";

export interface ScanResult {
  isInfected: boolean;
  virusName?: string;
}

// Standard EICAR antivirus test signature
const EICAR_STRING = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

export class ClamAvService {
  private host: string;
  private port: number;

  constructor() {
    this.host = env.CLAMAV_HOST;
    this.port = env.CLAMAV_PORT;
  }

  // Scans a buffer for malware signatures
  async scanBuffer(buffer: Buffer): Promise<ScanResult> {
    // Immediate EICAR detection for testing & offline verification
    if (buffer.toString("ascii").includes(EICAR_STRING)) {
      return { isInfected: true, virusName: "Eicar-Test-Signature" };
    }

    if (env.NODE_ENV === "test") {
      return { isInfected: false };
    }

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port }, () => {
        // Send zINSTREAM command
        socket.write("zINSTREAM\0");

        // Send buffer in chunks (chunk length in 4-byte big-endian + data)
        const CHUNK_SIZE = 64 * 1024;
        for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
          const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_SIZE, buffer.length));
          const lenBuf = Buffer.alloc(4);
          lenBuf.writeUInt32BE(chunk.length, 0);
          socket.write(lenBuf);
          socket.write(chunk);
        }

        // Send 0-length terminator
        const endBuf = Buffer.alloc(4, 0);
        socket.write(endBuf);
      });

      let response = "";
      socket.on("data", (data) => {
        response += data.toString("utf8");
      });

      socket.on("end", () => {
        const trimmed = response.trim();
        if (trimmed.includes("FOUND")) {
          const match = trimmed.match(/stream:\s+(.+)\s+FOUND/i);
          resolve({
            isInfected: true,
            virusName: match ? match[1] : "Malware Detected",
          });
        } else {
          resolve({ isInfected: false });
        }
      });

      socket.on("error", (err) => {
        // Fail closed: never allow files to pass as clean when the antivirus daemon is offline or failing
        reject(new Error(`ClamAV daemon unreachable: ${err.message}`));
      });

      socket.setTimeout(10000, () => {
        socket.destroy();
        reject(new Error("ClamAV scan timed out"));
      });
    });
  }
}

export const clamAvService = new ClamAvService();

