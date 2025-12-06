/**
 * File Upload Middleware
 * 
 * Configures multer for handling multipart file uploads.
 * Supports images and videos up to 500MB.
 */

import multer, { FileFilterCallback } from "multer";
import { Request } from "express";
import path from "path";
import { config } from "../config";

// =============================================================================
// Allowed MIME Types
// =============================================================================

export const ALLOWED_MIME_TYPES = {
  // Images
  "image/png": "IMAGE",
  "image/jpeg": "IMAGE",
  "image/jpg": "IMAGE",
  "image/gif": "IMAGE",
  "image/webp": "IMAGE",
  // Videos
  "video/mp4": "VIDEO",
  "video/webm": "VIDEO",
  "video/quicktime": "VIDEO",
  "video/x-msvideo": "VIDEO",
  "video/x-matroska": "VIDEO",
  "video/mpeg": "VIDEO",
  // HTML
  "text/html": "HTML",
  "application/zip": "HTML",
} as const;

export type FileType = "IMAGE" | "VIDEO" | "HTML" | "URL";

/**
 * Get asset type from MIME type
 */
export function getAssetTypeFromMime(mimeType: string): FileType | null {
  return (ALLOWED_MIME_TYPES as Record<string, FileType>)[mimeType] || null;
}

// =============================================================================
// File Filter
// =============================================================================

const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: FileFilterCallback
) => {
  const mimeType = file.mimetype.toLowerCase();
  
  if (ALLOWED_MIME_TYPES.hasOwnProperty(mimeType)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${mimeType}. Allowed types: ${Object.keys(ALLOWED_MIME_TYPES).join(", ")}`));
  }
};

// =============================================================================
// Multer Configuration
// =============================================================================

/**
 * Memory storage - files stored in buffer for S3 upload
 */
const storage = multer.memoryStorage();

/**
 * Multer instance for file uploads
 * Max file size: 500MB
 */
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxFileSize, // 500MB
    files: 1, // Single file per request
  },
});

/**
 * Multer instance for multiple files
 */
export const uploadMultiple = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxFileSize, // 500MB
    files: 10, // Max 10 files per request
  },
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

/**
 * Check if file extension is allowed
 */
export function isExtensionAllowed(filename: string): boolean {
  const ext = getFileExtension(filename);
  return config.upload.allowedExtensions.includes(ext);
}

/**
 * Get human-readable file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
