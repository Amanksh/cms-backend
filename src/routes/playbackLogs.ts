import { Router, Request, Response } from "express";
import PlaybackLog from "../models/PlaybackLog";

/**
 * Playback Logs Routes (Proof-of-Play)
 * 
 * This module provides API endpoints for:
 * 1. Logging playback events from digital signage players (POST /log)
 * 2. Generating aggregated playback reports (GET /report)
 * 3. Quick statistics (GET /stats)
 * 
 * Field names match EXACTLY what Android Player sends:
 * - deviceId, assetId, playlistId, startTime, endTime, duration
 */

const router = Router();

// ============================================================================
// Types & Interfaces
// ============================================================================

// Input format matching Android Player payload
interface PlaybackLogInput {
  deviceId: string;
  assetId: string;
  playlistId?: string;
  startTime: string;
  endTime: string;
  duration: number;
}

// Query parameters for the report endpoint
interface ReportQuery {
  deviceId?: string;
  assetId?: string;
  playlistId?: string;
  date_from?: string;
  date_to?: string;
  page?: string;
  limit?: string;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validates required fields in a playback log entry
 * @param log - The log entry to validate
 * @returns Array of validation error messages (empty if valid)
 */
function validateLogEntry(log: PlaybackLogInput): string[] {
  const errors: string[] = [];

  if (!log.deviceId || typeof log.deviceId !== "string") {
    errors.push("deviceId is required and must be a string");
  }
  if (!log.assetId || typeof log.assetId !== "string") {
    errors.push("assetId is required and must be a string");
  }
  if (!log.startTime) {
    errors.push("startTime is required");
  } else if (isNaN(Date.parse(log.startTime))) {
    errors.push("startTime must be a valid ISO date string");
  }
  if (!log.endTime) {
    errors.push("endTime is required");
  } else if (isNaN(Date.parse(log.endTime))) {
    errors.push("endTime must be a valid ISO date string");
  }
  if (log.duration === undefined || log.duration === null) {
    errors.push("duration is required");
  } else if (typeof log.duration !== "number" || log.duration < 0) {
    errors.push("duration must be a non-negative number");
  }

  return errors;
}

// ============================================================================
// POST /log - Log Playback Events
// ============================================================================

/**
 * POST /api/playback/log
 * 
 * Accepts single playback log or array of logs from digital signage players.
 * Performs bulk insert for efficiency when handling large batches.
 * 
 * Request Body (Single):
 *   { deviceId, assetId, playlistId?, startTime, endTime, duration }
 * 
 * Request Body (Array):
 *   [{ deviceId, assetId, playlistId?, startTime, endTime, duration }, ...]
 * 
 * Response:
 *   - Success: { success: true, count: X }
 *   - Error: { success: false, error: "message", details?: [...] }
 */
router.post("/log", async (req: Request, res: Response) => {
  try {
    // Normalize input: accept single object or array
    const logs: PlaybackLogInput[] = Array.isArray(req.body)
      ? req.body
      : [req.body];

    // Check if we received any data
    if (logs.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No playback logs provided",
      });
    }

    // Validate all entries before inserting
    const validationErrors: { index: number; errors: string[] }[] = [];
    
    logs.forEach((log, index) => {
      const errors = validateLogEntry(log);
      if (errors.length > 0) {
        validationErrors.push({ index, errors });
      }
    });

    // If any validation errors, return them all
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Validation failed for one or more log entries",
        details: validationErrors,
      });
    }

    // Transform input data to model format
    const documents = logs.map((log) => ({
      deviceId: log.deviceId.trim(),
      assetId: log.assetId.trim(),
      playlistId: log.playlistId?.trim() || null,
      startTime: new Date(log.startTime),
      endTime: new Date(log.endTime),
      duration: log.duration,
      createdAt: new Date(),
    }));

    // Bulk insert for efficiency
    const result = await PlaybackLog.insertMany(documents, {
      ordered: false,
    });

    // Return success response
    return res.status(201).json({
      success: true,
      count: result.length,
      message: `Successfully logged ${result.length} playback event(s)`,
    });
  } catch (error: any) {
    console.error("Error logging playback:", error);

    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "Duplicate playback log entry detected",
      });
    }

    // Handle bulk write errors (partial failures)
    if (error.name === "BulkWriteError") {
      const insertedCount = error.result?.nInserted || 0;
      return res.status(207).json({
        success: false,
        error: "Partial insert failure",
        count: insertedCount,
        totalAttempted: error.result?.nInserted + error.writeErrors?.length,
      });
    }

    // Generic error response
    return res.status(500).json({
      success: false,
      error: "Internal server error while logging playback",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /report - Generate Playback Reports
// ============================================================================

/**
 * GET /api/playback/report
 * 
 * Generates aggregated playback reports with filtering and pagination.
 * 
 * Query Parameters:
 *   - deviceId: Filter by specific device
 *   - assetId: Filter by specific asset
 *   - playlistId: Filter by specific playlist
 *   - date_from: Start date for time range (ISO format)
 *   - date_to: End date for time range (ISO format)
 *   - page: Page number for pagination (default: 1)
 *   - limit: Results per page (default: 50, max: 1000)
 */
router.get("/report", async (req: Request, res: Response) => {
  try {
    const {
      deviceId,
      assetId,
      playlistId,
      date_from,
      date_to,
      page = "1",
      limit = "50",
    } = req.query as ReportQuery;

    // Parse and validate pagination parameters
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Build match stage for filtering
    const matchStage: Record<string, any> = {};

    if (deviceId) {
      matchStage.deviceId = deviceId;
    }

    if (assetId) {
      matchStage.assetId = assetId;
    }

    if (playlistId) {
      matchStage.playlistId = playlistId;
    }

    // Filter by date range if provided
    if (date_from || date_to) {
      matchStage.startTime = {};
      
      if (date_from) {
        const fromDate = new Date(date_from);
        if (isNaN(fromDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid date_from format. Use ISO date format (e.g., 2025-11-26T00:00:00Z)",
          });
        }
        matchStage.startTime.$gte = fromDate;
      }
      
      if (date_to) {
        const toDate = new Date(date_to);
        if (isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid date_to format. Use ISO date format (e.g., 2025-11-26T23:59:59Z)",
          });
        }
        matchStage.startTime.$lte = toDate;
      }
    }

    // Build aggregation pipeline
    const pipeline: any[] = [];

    // Stage 1: Match (filter) documents
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Stage 2: Group by assetId and calculate aggregates
    pipeline.push({
      $group: {
        _id: "$assetId",
        play_count: { $sum: 1 },
        total_duration: { $sum: "$duration" },
        first_played: { $min: "$startTime" },
        last_played: { $max: "$startTime" },
        unique_devices: { $addToSet: "$deviceId" },
      },
    });

    // Stage 3: Project to final shape
    pipeline.push({
      $project: {
        _id: 0,
        assetId: "$_id",
        play_count: 1,
        total_duration: 1,
        first_played: 1,
        last_played: 1,
        unique_device_count: { $size: "$unique_devices" },
      },
    });

    // Stage 4: Sort by play_count descending
    pipeline.push({ $sort: { play_count: -1 } });

    // Create a facet to get both data and total count
    const facetPipeline = [
      ...pipeline,
      {
        $facet: {
          summary: [{ $skip: skip }, { $limit: limitNum }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    // Execute aggregation
    const results = await PlaybackLog.aggregate(facetPipeline);

    // Extract results
    const summary = results[0]?.summary || [];
    const totalCount = results[0]?.totalCount[0]?.count || 0;
    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      summary,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      filters: {
        deviceId: deviceId || null,
        assetId: assetId || null,
        playlistId: playlistId || null,
        date_from: date_from || null,
        date_to: date_to || null,
      },
    });
  } catch (error: any) {
    console.error("Error generating playback report:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error while generating report",
      message: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /stats - Quick Statistics Endpoint
// ============================================================================

/**
 * GET /api/playback/stats
 * 
 * Returns quick overall statistics without detailed breakdown.
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query as { date_from?: string; date_to?: string };

    // Build match stage for optional date filtering
    const matchStage: Record<string, any> = {};
    
    if (date_from || date_to) {
      matchStage.startTime = {};
      if (date_from) matchStage.startTime.$gte = new Date(date_from);
      if (date_to) matchStage.startTime.$lte = new Date(date_to);
    }

    // Build aggregation pipeline
    const pipeline: any[] = [];
    
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push({
      $group: {
        _id: null,
        total_plays: { $sum: 1 },
        total_duration: { $sum: "$duration" },
        unique_assets: { $addToSet: "$assetId" },
        unique_devices: { $addToSet: "$deviceId" },
        unique_playlists: { $addToSet: "$playlistId" },
        earliest_play: { $min: "$startTime" },
        latest_play: { $max: "$startTime" },
      },
    });

    pipeline.push({
      $project: {
        _id: 0,
        total_plays: 1,
        total_duration: 1,
        unique_asset_count: { $size: "$unique_assets" },
        unique_device_count: { $size: "$unique_devices" },
        unique_playlist_count: { 
          $size: { 
            $filter: { 
              input: "$unique_playlists", 
              cond: { $ne: ["$$this", null] } 
            } 
          } 
        },
        earliest_play: 1,
        latest_play: 1,
      },
    });

    const results = await PlaybackLog.aggregate(pipeline);

    // Return default values if no data exists
    const stats = results[0] || {
      total_plays: 0,
      total_duration: 0,
      unique_asset_count: 0,
      unique_device_count: 0,
      unique_playlist_count: 0,
      earliest_play: null,
      latest_play: null,
    };

    return res.status(200).json({
      success: true,
      stats,
      filters: {
        date_from: date_from || null,
        date_to: date_to || null,
      },
    });
  } catch (error: any) {
    console.error("Error fetching playback stats:", error);

    return res.status(500).json({
      success: false,
      error: "Internal server error while fetching stats",
    });
  }
});

// ============================================================================
// GET /logs - Get Raw Logs (for debugging/dashboard)
// ============================================================================

/**
 * GET /api/playback/logs
 * 
 * Returns raw playback logs with pagination.
 */
router.get("/logs", async (req: Request, res: Response) => {
  try {
    const {
      deviceId,
      assetId,
      playlistId,
      date_from,
      date_to,
      page = "1",
      limit = "50",
    } = req.query as ReportQuery;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Build filter
    const filter: Record<string, any> = {};

    if (deviceId) filter.deviceId = deviceId;
    if (assetId) filter.assetId = assetId;
    if (playlistId) filter.playlistId = playlistId;

    if (date_from || date_to) {
      filter.startTime = {};
      if (date_from) filter.startTime.$gte = new Date(date_from);
      if (date_to) filter.startTime.$lte = new Date(date_to);
    }

    const [logs, totalCount] = await Promise.all([
      PlaybackLog.find(filter)
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      PlaybackLog.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (error: any) {
    console.error("Error fetching playback logs:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while fetching logs",
    });
  }
});

// Export the router
export const playbackRoutes = router;
