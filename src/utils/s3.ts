/**
 * S3 Utility Module
 * 
 * Handles AWS S3 operations for file uploads.
 * Supports presigned URLs for direct client uploads and server-side uploads.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";

// =============================================================================
// S3 Client Setup
// =============================================================================

let s3Client: S3Client | null = null;

/**
 * Get or create S3 client instance
 */
export function getS3Client(): S3Client | null {
  if (!config.aws.accessKeyId || !config.aws.secretAccessKey || !config.aws.bucketName) {
    console.warn("⚠️  AWS S3 not configured. File uploads will be disabled.");
    return null;
  }

  if (!s3Client) {
    s3Client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
    });
  }

  return s3Client;
}

/**
 * Check if S3 is configured
 */
export function isS3Configured(): boolean {
  return !!(config.aws.accessKeyId && config.aws.secretAccessKey && config.aws.bucketName);
}

// =============================================================================
// S3 Operations
// =============================================================================

/**
 * Generate a unique S3 key for a file
 */
export function generateS3Key(filename: string, userId: string): string {
  // Sanitize userId to use as folder
  const folder = userId.replace(/[^a-zA-Z0-9]/g, "-");
  // Add timestamp to prevent collisions
  const timestamp = Date.now();
  // Sanitize filename
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `${folder}/${timestamp}-${sanitizedFilename}`;
}

/**
 * Get a presigned URL for client-side upload
 */
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<{ signedUrl: string; publicUrl: string }> {
  const client = getS3Client();
  if (!client) {
    throw new Error("S3 is not configured");
  }

  const command = new PutObjectCommand({
    Bucket: config.aws.bucketName,
    Key: key,
    ContentType: contentType,
  });

  const signedUrl = await getSignedUrl(client, command, { expiresIn });
  const publicUrl = `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${key}`;

  return { signedUrl, publicUrl };
}

/**
 * Upload a file buffer directly to S3
 */
export async function uploadToS3(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string> {
  const client = getS3Client();
  if (!client) {
    throw new Error("S3 is not configured");
  }

  const command = new PutObjectCommand({
    Bucket: config.aws.bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await client.send(command);

  return `https://${config.aws.bucketName}.s3.${config.aws.region}.amazonaws.com/${key}`;
}

/**
 * Delete a file from S3
 */
export async function deleteFromS3(key: string): Promise<void> {
  const client = getS3Client();
  if (!client) {
    throw new Error("S3 is not configured");
  }

  const command = new DeleteObjectCommand({
    Bucket: config.aws.bucketName,
    Key: key,
  });

  await client.send(command);
}

/**
 * Extract S3 key from public URL
 */
export function extractS3KeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Remove leading slash
    return urlObj.pathname.substring(1);
  } catch {
    return null;
  }
}
