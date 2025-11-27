import { Router, Request, Response } from "express";
import PlaybackLog, { IPlaybackLog } from "../models/PlaybackLog";

/**
 * Playback Logs Routes
 * 
 * This module provides API endpoints for:
 * 1. Logging playback events from digital signage players (POST /log)
 * 2. Generating aggregated playback reports (GET /report)
 * 
 * Designed for high-volume data ingestion and efficient reporting.
 */

const router = Router();

// ============================================================================
// Types & Interfaces
// ============================================================================

// Input format for a single playback log entry
interface PlaybackLogInput {
  device_id: string;
  asset_id: string;
  playlist_id?: string;
  start_time: string;
  end_time: string;
  duration: number;
}

// Query parameters for the report endpoint
interface ReportQuery {
  device_id?: string;
  asset_id?: string;
  playlist_id?: string;
  date_from?: string;
  date_to?: string;
  page?: string;
  limit?: string;
}

// Summary item in report response
interface PlaybackSummary {
  asset_id: string;
  play_count: number;
  total_duration: number;
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

  if (!log.device_id || typeof log.device_id !== "string") {
    errors.push("device_id is required and must be a string");
  }
  if (!log.asset_id || typeof log.asset_id !== "string") {
    errors.push("asset_id is required and must be a string");
  }
  if (!log.start_time) {
    errors.push("start_time is required");
  } else if (isNaN(Date.parse(log.start_time))) {
    errors.push("start_time must be a valid ISO date string");
  }
  if (!log.end_time) {
    errors.push("end_time is required");
  } else if (isNaN(Date.parse(log.end_time))) {
    errors.push("end_time must be a valid ISO date string");
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
 * Request Body:
 *   - Single object: { device_id, asset_id, playlist_id?, start_time, end_time, duration }
 *   - Array of objects: [{ ... }, { ... }, ...]
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
      device_id: log.device_id.trim(),
      asset_id: log.asset_id.trim(),
      playlist_id: log.playlist_id?.trim() || null,
      start_time: new Date(log.start_time),
      end_time: new Date(log.end_time),
      duration: log.duration,
      created_at: new Date(),
    }));

    // Bulk insert for efficiency
    // Using insertMany with ordered: false allows partial success
    // (continues inserting even if some documents fail)
    const result = await PlaybackLog.insertMany(documents, {
      ordered: false,
      // Bypass document validation for performance (we validated above)
      lean: true,
    });

    // Return success response
    return res.status(201).json({
      success: true,
      count: result.length,
      message: `Successfully logged ${result.length} playback event(s)`,
    });
  } catch (error: any) {
    console.error("Error logging playback:", error);

    // Handle duplicate key errors (if any unique constraints exist)
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
 * Uses MongoDB aggregation pipeline for efficient server-side processing.
 * 
 * Query Parameters:
 *   - device_id: Filter by specific device
 *   - asset_id: Filter by specific asset
 *   - playlist_id: Filter by specific playlist
 *   - date_from: Start date for time range (ISO format)
 *   - date_to: End date for time range (ISO format)
 *   - page: Page number for pagination (default: 1)
 *   - limit: Results per page (default: 50, max: 1000)
 * 
 * Response:
 *   {
 *     success: true,
 *     summary: [{ asset_id, play_count, total_duration }, ...],
 *     pagination: { page, limit, total, totalPages }
 *   }
 */
router.get("/report", async (req: Request, res: Response) => {
  try {
    const {
      device_id,
      asset_id,
      playlist_id,
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

    // Filter by device_id if provided
    if (device_id) {
      matchStage.device_id = device_id;
    }

    // Filter by asset_id if provided
    if (asset_id) {
      matchStage.asset_id = asset_id;
    }

    // Filter by playlist_id if provided
    if (playlist_id) {
      matchStage.playlist_id = playlist_id;
    }

    // Filter by date range if provided
    if (date_from || date_to) {
      matchStage.start_time = {};
      
      if (date_from) {
        const fromDate = new Date(date_from);
        if (isNaN(fromDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid date_from format. Use ISO date format (e.g., 2025-11-26T00:00:00Z)",
          });
        }
        matchStage.start_time.$gte = fromDate;
      }
      
      if (date_to) {
        const toDate = new Date(date_to);
        if (isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid date_to format. Use ISO date format (e.g., 2025-11-26T23:59:59Z)",
          });
        }
        matchStage.start_time.$lte = toDate;
      }
    }

    // Build aggregation pipeline
    const pipeline: any[] = [];

    // Stage 1: Match (filter) documents
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Stage 2: Group by asset_id and calculate aggregates
    pipeline.push({
      $group: {
        _id: "$asset_id",
        play_count: { $sum: 1 },
        total_duration: { $sum: "$duration" },
        // Additional useful metrics
        first_played: { $min: "$start_time" },
        last_played: { $max: "$start_time" },
        unique_devices: { $addToSet: "$device_id" },
      },
    });

    // Stage 3: Project to final shape
    pipeline.push({
      $project: {
        _id: 0,
        asset_id: "$_id",
        play_count: 1,
        total_duration: 1,
        first_played: 1,
        last_played: 1,
        unique_device_count: { $size: "$unique_devices" },
      },
    });

    // Stage 4: Sort by play_count descending (most played first)
    pipeline.push({ $sort: { play_count: -1 } });

    // Create a facet to get both data and total count efficiently
    const facetPipeline = [
      ...pipeline,
      {
        $facet: {
          // Get paginated results
          summary: [{ $skip: skip }, { $limit: limitNum }],
          // Get total count for pagination
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    // Execute aggregation
    const results = await PlaybackLog.aggregate(facetPipeline);

    // Extract results from facet
    const summary: PlaybackSummary[] = results[0]?.summary || [];
    const totalCount = results[0]?.totalCount[0]?.count || 0;
    const totalPages = Math.ceil(totalCount / limitNum);

    // Return success response with pagination info
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
        device_id: device_id || null,
        asset_id: asset_id || null,
        playlist_id: playlist_id || null,
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
// GET /stats - Quick Statistics Endpoint (Bonus)
// ============================================================================

/**
 * GET /api/playback/stats
 * 
 * Returns quick overall statistics without detailed breakdown.
 * Useful for dashboards and monitoring.
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query as { date_from?: string; date_to?: string };

    // Build match stage for optional date filtering
    const matchStage: Record<string, any> = {};
    
    if (date_from || date_to) {
      matchStage.start_time = {};
      if (date_from) matchStage.start_time.$gte = new Date(date_from);
      if (date_to) matchStage.start_time.$lte = new Date(date_to);
    }

    // Build aggregation pipeline for stats
    const pipeline: any[] = [];
    
    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push({
      $group: {
        _id: null,
        total_plays: { $sum: 1 },
        total_duration: { $sum: "$duration" },
        unique_assets: { $addToSet: "$asset_id" },
        unique_devices: { $addToSet: "$device_id" },
        unique_playlists: { $addToSet: "$playlist_id" },
        earliest_play: { $min: "$start_time" },
        latest_play: { $max: "$start_time" },
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

// Export the router
export const playbackRoutes = router;

