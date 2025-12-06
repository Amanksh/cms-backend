/**
 * Centralized Configuration Module
 * 
 * All environment variables and configuration settings are managed here.
 * This ensures type safety and provides defaults for development.
 */

import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// =============================================================================
// Configuration Object
// =============================================================================

export const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "5000", 10),
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV === "development",

  // Database
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/cms",

  // Email (Resend)
  resendApiKey: process.env.RESEND_API_KEY || "",
  toEmail: process.env.TO_EMAIL || "",
  defaultFromEmail: process.env.DEFAULT_FROM_EMAIL || "Orion-Connect <no-reply@orionconnect.in>",

  // CORS
  corsOrigins: process.env.CORS_ORIGINS?.split(",").map(origin => origin.trim()) || [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8080",
  ],

  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "900000", 10), // 15 minutes
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),

  // API
  apiBaseUrl: process.env.API_BASE_URL || "http://localhost:5000",

  // AWS S3 Configuration
  aws: {
    region: process.env.AWS_REGION || process.env.REGION || "ap-south-1",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.ACCESS_KEY || "",
    bucketName: process.env.AWS_BUCKET_NAME || "",
  },

  // File Upload Configuration
  upload: {
    maxFileSize: 500 * 1024 * 1024, // 500MB
    allowedMimeTypes: [
      // Images
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/gif",
      "image/webp",
      // Videos
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-matroska",
      // HTML
      "text/html",
      "application/zip",
    ],
    allowedExtensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp4", ".webm", ".mov", ".avi", ".mkv", ".html", ".zip"],
  },
};

// =============================================================================
// Validation
// =============================================================================

/**
 * Validates that all required environment variables are set
 * Throws an error in production if required vars are missing
 */
export function validateConfig(): void {
  const requiredVars = ["MONGODB_URI"];
  const missingVars: string[] = [];

  // In production, require email configuration
  if (config.isProduction) {
    requiredVars.push("RESEND_API_KEY", "TO_EMAIL");
  }

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    const message = `Missing required environment variables: ${missingVars.join(", ")}`;
    if (config.isProduction) {
      throw new Error(message);
    } else {
      console.warn(`⚠️  Warning: ${message}`);
    }
  }
}

// =============================================================================
// Export
// =============================================================================

export default config;

