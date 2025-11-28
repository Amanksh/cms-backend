/**
 * CMS Backend Server
 * 
 * Digital Signage Content Management System API
 * Handles displays, playlists, assets, playback logging, and email notifications.
 */

import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";

// Configuration
import { config, validateConfig } from "./config";

// Routes
import { displayRoutes } from "./routes/display.routes";
import { emailRoutes } from "./routes/email.routes";
import { playbackRoutes } from "./routes/playbackLogs";
import { assetRoutes } from "./routes/asset.routes";

// Middleware
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

// Import models to ensure they are registered
import "./models/Display";
import "./models/Playlist";
import "./models/Asset";
import "./models/PlaybackLog";

// =============================================================================
// Validate Configuration
// =============================================================================
validateConfig();

// =============================================================================
// Express App Setup
// =============================================================================
const app = express();

// =============================================================================
// Security Middleware
// =============================================================================

// Helmet - Set security HTTP headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// CORS Configuration
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (config.corsOrigins.includes(origin) || config.isDevelopment) {
      return callback(null, true);
    }
    
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));

// Rate Limiting
const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all API routes
app.use("/api/", limiter);

// =============================================================================
// Body Parsing Middleware
// =============================================================================

// Parse JSON bodies (with size limit)
app.use(express.json({ limit: "10mb" }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Compression for responses
app.use(compression());

// =============================================================================
// Database Connection
// =============================================================================
mongoose
  .connect(config.mongodbUri)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    console.log(`   Database: ${config.mongodbUri.split("/").pop()?.split("?")[0]}`);
  })
  .catch((error) => {
    console.error("❌ MongoDB connection error:", error.message);
    if (config.isProduction) {
      process.exit(1);
    }
  });

// Handle MongoDB connection events
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️  MongoDB disconnected");
});

mongoose.connection.on("reconnected", () => {
  console.log("✅ MongoDB reconnected");
});

// =============================================================================
// API Routes
// =============================================================================

// Health check endpoint
app.get("/health", async (req, res) => {
  const healthStatus = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    uptime: process.uptime(),
    uptimeFormatted: formatUptime(process.uptime()),
    services: {
      database: {
        status: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        readyState: mongoose.connection.readyState,
        name: mongoose.connection.name || "unknown",
      },
      server: {
        status: "running",
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: "MB",
        },
      },
    },
  };

  // Determine overall health status
  const isHealthy = mongoose.connection.readyState === 1;
  healthStatus.status = isHealthy ? "healthy" : "degraded";

  // Return appropriate status code
  const statusCode = isHealthy ? 200 : 503;
  res.status(statusCode).json(healthStatus);
});

// Helper function to format uptime
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

// API info endpoint
app.get("/api", (req, res) => {
  res.json({
    name: "CMS Backend API",
    version: "1.0.0",
    endpoints: {
      health: "GET /health",
      displays: {
        trackPlayback: "POST /api/displays/playback",
        getByDeviceId: "GET /api/displays/device/:deviceId",
      },
      playback: {
        log: "POST /api/playback/log",
        report: "GET /api/playback/report",
        stats: "GET /api/playback/stats",
      },
      assets: {
        list: "GET /api/assets",
        getById: "GET /api/assets/:id",
        download: "GET /api/assets/:id/download",
        getByName: "GET /api/assets/by-name/:name",
        create: "POST /api/assets",
        update: "PUT /api/assets/:id",
        delete: "DELETE /api/assets/:id",
        stats: "GET /api/assets/stats/summary",
      },
      email: {
        quoteRequest: "POST /api/email/quote-request",
      },
    },
  });
});

// Mount route handlers
app.use("/api/displays", displayRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/playback", playbackRoutes);
app.use("/api/assets", assetRoutes);

// =============================================================================
// Error Handling
// =============================================================================

// 404 handler for unknown routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// =============================================================================
// Server Startup
// =============================================================================
const server = app.listen(config.port, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    CMS Backend Server                          ║
╠════════════════════════════════════════════════════════════════╣
║  Status:      🟢 Running                                       ║
║  Environment: ${config.nodeEnv.padEnd(46)}║
║  Port:        ${String(config.port).padEnd(46)}║
║  URL:         http://localhost:${config.port}${" ".repeat(30 - String(config.port).length)}║
╠════════════════════════════════════════════════════════════════╣
║  API Endpoints:                                                ║
║    • GET  /health                                              ║
║    • GET  /api                                                 ║
║    • POST /api/displays/playback                               ║
║    • GET  /api/displays/device/:deviceId                       ║
║    • POST /api/playback/log                                    ║
║    • GET  /api/playback/report                                 ║
║    • GET  /api/playback/stats                                  ║
║    • POST /api/email/quote-request                             ║
╚════════════════════════════════════════════════════════════════╝
  `);
});

// =============================================================================
// Graceful Shutdown
// =============================================================================
const gracefulShutdown = (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  server.close(() => {
    console.log("HTTP server closed");
    
    mongoose.connection.close(false).then(() => {
      console.log("MongoDB connection closed");
      process.exit(0);
    });
  });

  // Force close after 10s
  setTimeout(() => {
    console.error("Forcefully shutting down");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default app;
