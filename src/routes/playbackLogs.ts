import { Router, Request, Response } from "express";
import PlaybackLog from "../models/PlaybackLog";

/**
 * Playback Logs Routes (Proof-of-Play)
 * 
 * Accepts BOTH camelCase and snake_case field names for flexibility:
 * - deviceId OR device_id
 * - assetId OR asset_id
 * - playlistId OR playlist_id
 * - startTime OR start_time
 * - endTime OR end_time
 * 
 * Data is stored in MongoDB using snake_case (for consistency with existing data).
 */

const router = Router();

// ============================================================================
// Types & Interfaces
// ============================================================================

// Flexible input that accepts both camelCase and snake_case
interface PlaybackLogInput {
  // camelCase (Android Player format)
  deviceId?: string;
  assetId?: string;
  playlistId?: string;
  startTime?: string;
  endTime?: string;
  // snake_case (original format)
  device_id?: string;
  asset_id?: string;
  playlist_id?: string;
  start_time?: string;
  end_time?: string;
  // duration is same in both
  duration: number;
}

interface ReportQuery {
  deviceId?: string;
  device_id?: string;
  assetId?: string;
  asset_id?: string;
  playlistId?: string;
  playlist_id?: string;
  date_from?: string;
  date_to?: string;
  page?: string;
  limit?: string;
}

// ============================================================================
// Helper: Normalize Input (accept both formats)
// ============================================================================

function normalizeLogInput(log: PlaybackLogInput) {
  return {
    device_id: (log.deviceId || log.device_id || "").trim(),
    asset_id: (log.assetId || log.asset_id || "").trim(),
    playlist_id: (log.playlistId || log.playlist_id || "")?.trim() || null,
    start_time: log.startTime || log.start_time || "",
    end_time: log.endTime || log.end_time || "",
    duration: log.duration,
  };
}

// ============================================================================
// Validation
// ============================================================================

function validateLogEntry(log: ReturnType<typeof normalizeLogInput>): string[] {
  const errors: string[] = [];

  if (!log.device_id) {
    errors.push("deviceId/device_id is required");
  }
  if (!log.asset_id) {
    errors.push("assetId/asset_id is required");
  }
  if (!log.start_time) {
    errors.push("startTime/start_time is required");
  } else if (isNaN(Date.parse(log.start_time))) {
    errors.push("startTime/start_time must be a valid ISO date string");
  }
  if (!log.end_time) {
    errors.push("endTime/end_time is required");
  } else if (isNaN(Date.parse(log.end_time))) {
    errors.push("endTime/end_time must be a valid ISO date string");
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
 * Accepts BOTH camelCase and snake_case field names.
 * 
 * Example payloads:
 * 
 * camelCase (Android Player):
 * { "deviceId": "PLAYER_01", "assetId": "video.mp4", "startTime": "...", "endTime": "...", "duration": 30 }
 * 
 * snake_case (original):
 * { "device_id": "PLAYER_01", "asset_id": "video.mp4", "start_time": "...", "end_time": "...", "duration": 30 }
 */
router.post("/log", async (req: Request, res: Response) => {
  try {
    const rawLogs: PlaybackLogInput[] = Array.isArray(req.body) ? req.body : [req.body];

    if (rawLogs.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No playback logs provided",
      });
    }

    // Normalize all logs to snake_case
    const normalizedLogs = rawLogs.map(normalizeLogInput);

    // Validate all entries
    const validationErrors: { index: number; errors: string[] }[] = [];
    normalizedLogs.forEach((log, index) => {
      const errors = validateLogEntry(log);
      if (errors.length > 0) {
        validationErrors.push({ index, errors });
      }
    });

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: "Validation failed for one or more log entries",
        details: validationErrors,
      });
    }

    // Transform to documents
    const documents = normalizedLogs.map((log) => ({
      device_id: log.device_id,
      asset_id: log.asset_id,
      playlist_id: log.playlist_id,
      start_time: new Date(log.start_time),
      end_time: new Date(log.end_time),
      duration: log.duration,
      created_at: new Date(),
    }));

    // Bulk insert
    const result = await PlaybackLog.insertMany(documents, { ordered: false });

    return res.status(201).json({
      success: true,
      count: result.length,
      message: `Successfully logged ${result.length} playback event(s)`,
    });
  } catch (error: any) {
    console.error("Error logging playback:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "Duplicate playback log entry detected",
      });
    }

    if (error.name === "BulkWriteError") {
      const insertedCount = error.result?.nInserted || 0;
      return res.status(207).json({
        success: false,
        error: "Partial insert failure",
        count: insertedCount,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Internal server error while logging playback",
    });
  }
});

// ============================================================================
// GET /report - Generate Playback Reports
// ============================================================================

router.get("/report", async (req: Request, res: Response) => {
  try {
    const query = req.query as ReportQuery;
    
    // Accept both camelCase and snake_case query params
    const deviceId = query.deviceId || query.device_id;
    const assetId = query.assetId || query.asset_id;
    const playlistId = query.playlistId || query.playlist_id;
    const { date_from, date_to, page = "1", limit = "50" } = query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Build match stage (using snake_case for DB query)
    const matchStage: Record<string, any> = {};

    if (deviceId) matchStage.device_id = deviceId;
    if (assetId) matchStage.asset_id = assetId;
    if (playlistId) matchStage.playlist_id = playlistId;

    if (date_from || date_to) {
      matchStage.start_time = {};
      if (date_from) {
        const fromDate = new Date(date_from);
        if (isNaN(fromDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid date_from format",
          });
        }
        matchStage.start_time.$gte = fromDate;
      }
      if (date_to) {
        const toDate = new Date(date_to);
        if (isNaN(toDate.getTime())) {
          return res.status(400).json({
            success: false,
            error: "Invalid date_to format",
          });
        }
        matchStage.start_time.$lte = toDate;
      }
    }

    // Aggregation pipeline (using snake_case field names)
    const pipeline: any[] = [];

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    pipeline.push({
      $group: {
        _id: "$asset_id",
        play_count: { $sum: 1 },
        total_duration: { $sum: "$duration" },
        first_played: { $min: "$start_time" },
        last_played: { $max: "$start_time" },
        unique_devices: { $addToSet: "$device_id" },
      },
    });

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

    pipeline.push({ $sort: { play_count: -1 } });

    const facetPipeline = [
      ...pipeline,
      {
        $facet: {
          summary: [{ $skip: skip }, { $limit: limitNum }],
          totalCount: [{ $count: "count" }],
        },
      },
    ];

    const results = await PlaybackLog.aggregate(facetPipeline);

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
        device_id: deviceId || null,
        asset_id: assetId || null,
        playlist_id: playlistId || null,
        date_from: date_from || null,
        date_to: date_to || null,
      },
    });
  } catch (error: any) {
    console.error("Error generating playback report:", error);
    return res.status(500).json({
      success: false,
      error: "Internal server error while generating report",
    });
  }
});

// ============================================================================
// GET /stats - Quick Statistics
// ============================================================================

router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query as { date_from?: string; date_to?: string };

    const matchStage: Record<string, any> = {};
    
    if (date_from || date_to) {
      matchStage.start_time = {};
      if (date_from) matchStage.start_time.$gte = new Date(date_from);
      if (date_to) matchStage.start_time.$lte = new Date(date_to);
    }

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
// GET /logs - Get Raw Logs
// ============================================================================

router.get("/logs", async (req: Request, res: Response) => {
  try {
    const query = req.query as ReportQuery;
    
    const deviceId = query.deviceId || query.device_id;
    const assetId = query.assetId || query.asset_id;
    const playlistId = query.playlistId || query.playlist_id;
    const { date_from, date_to, page = "1", limit = "50" } = query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const filter: Record<string, any> = {};

    if (deviceId) filter.device_id = deviceId;
    if (assetId) filter.asset_id = assetId;
    if (playlistId) filter.playlist_id = playlistId;

    if (date_from || date_to) {
      filter.start_time = {};
      if (date_from) filter.start_time.$gte = new Date(date_from);
      if (date_to) filter.start_time.$lte = new Date(date_to);
    }

    const [logs, totalCount] = await Promise.all([
      PlaybackLog.find(filter)
        .sort({ start_time: -1 })
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

export const playbackRoutes = router;
