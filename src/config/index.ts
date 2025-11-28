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

