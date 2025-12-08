import { Router, Request, Response, NextFunction } from "express";
import Asset from "../models/Asset";
import Campaign from "../models/Campaign";
import mongoose from "mongoose";
import { upload, getAssetTypeFromMime, formatFileSize, ALLOWED_MIME_TYPES } from "../middleware/upload";
import { uploadToS3, generateS3Key, isS3Configured } from "../utils/s3";
import { config } from "../config";

/**
 * Asset Routes
 * 
 * This module provides API endpoints for:
 * 1. Listing all assets with pagination and filtering
 * 2. Getting combined view (campaigns + direct assets) with ?view=combined
 * 3. Getting a single asset by ID
 * 4. Getting asset download URL / redirecting to asset
 * 5. Creating new assets (metadata) - campaignId is OPTIONAL
 * 6. Updating assets
 * 7. Deleting assets
 * 
 * Key validation rules:
 * - Assets can belong to a campaign OR be direct/standalone (campaignId = null)
 * - Maximum 9 assets per campaign (only applies when campaignId is set)
 */

const router = Router();

// ============================================================================
// Constants
// ============================================================================

const MAX_ASSETS_PER_CAMPAIGN = 9;

// ============================================================================
// Types & Interfaces
// ============================================================================

interface AssetQuery {
  type?: string;
  userId?: string;
  campaignId?: string;
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  view?: string; // "combined" for campaigns + direct assets
}

interface CreateAssetInput {
  name: string;
  type: "IMAGE" | "VIDEO" | "HTML" | "URL";
  url: string;
  thumbnail?: string;
  duration?: number;
  size: number;
  userId: string;
  campaignId?: string | null; // OPTIONAL - null for direct assets
}

// ============================================================================
// GET /assets - List All Assets
// ============================================================================

/**
 * GET /api/assets
 * 
 * Lists all assets with pagination, filtering, and search.
 * 
 * Query Parameters:
 *   - view: "combined" returns { campaigns, assets } structure (matches frontend)
 *   - type: Filter by asset type (IMAGE, VIDEO, HTML, URL)
 *   - userId: Filter by user ID (REQUIRED for view=combined)
 *   - campaignId: Filter by campaign ID
 *   - search: Search by name (case-insensitive)
 *   - page: Page number (default: 1)
 *   - limit: Results per page (default: 20, max: 100)
 *   - sortBy: Field to sort by (default: createdAt)
 *   - sortOrder: asc or desc (default: desc)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      type,
      userId,
      campaignId,
      search,
      page = "1",
      limit = "20",
      sortBy = "createdAt",
      sortOrder = "desc",
      view,
    } = req.query as AssetQuery;

    // ========================================================================
    // VIEW=COMBINED: Return campaigns + direct assets (matches frontend)
    // ========================================================================
    if (view === "combined") {
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required for combined view",
        });
      }

      // Get all campaigns with their assets
      const campaigns = await Campaign.find({ userId }).sort({ createdAt: -1 }).lean();

      const campaignsWithAssets = await Promise.all(
        campaigns.map(async (campaign) => {
          const assets = await Asset.find({ campaignId: campaign._id })
            .select("_id name type url thumbnail duration size createdAt")
            .sort({ createdAt: -1 })
            .lean();

          return {
            id: campaign._id,
            _id: campaign._id,
            name: campaign.name,
            description: campaign.description,
            type: "campaign" as const,
            assets: assets.map((asset: any) => ({
              assetId: asset._id,
              _id: asset._id,
              name: asset.name,
              type: asset.type,
              url: asset.url,
              thumbnail: asset.thumbnail,
              duration: asset.duration || 10,
              size: asset.size,
              createdAt: asset.createdAt,
            })),
            assetCount: assets.length,
            maxAssets: MAX_ASSETS_PER_CAMPAIGN,
            canAddMoreAssets: assets.length < MAX_ASSETS_PER_CAMPAIGN,
            createdAt: campaign.createdAt,
            updatedAt: campaign.updatedAt,
          };
        })
      );

      // Get direct assets (assets without campaignId)
      const directAssets = await Asset.find({
        userId,
        campaignId: null,
      })
        .sort({ createdAt: -1 })
        .select("_id name type url size createdAt duration thumbnail")
        .lean();

      const formattedDirectAssets = directAssets.map((asset: any) => ({
        _id: asset._id,
        id: asset._id,
        name: asset.name,
        type: asset.type,
        url: asset.url,
        thumbnail: asset.thumbnail,
        duration: asset.duration || 10,
        size: asset.size || 0,
        createdAt: asset.createdAt,
        itemType: "asset" as const,
      }));

      return res.status(200).json({
        success: true,
        campaigns: campaignsWithAssets,
        assets: formattedDirectAssets,
      });
    }

    // ========================================================================
    // DEFAULT VIEW: Standard asset listing with pagination
    // ========================================================================

    // Parse pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Build query filter
    const filter: Record<string, any> = {};

    if (type) {
      filter.type = type.toUpperCase();
    }

    if (userId) {
      filter.userId = userId;
    }

    if (campaignId) {
      if (campaignId === "null" || campaignId === "") {
        // Explicitly looking for direct assets
        filter.campaignId = null;
      } else if (!mongoose.Types.ObjectId.isValid(campaignId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid campaign ID format",
        });
      } else {
      filter.campaignId = new mongoose.Types.ObjectId(campaignId);
      }
    }

    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }

    // Build sort options
    const sortOptions: Record<string, 1 | -1> = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Execute queries in parallel
    const [assets, totalCount] = await Promise.all([
      Asset.find(filter)
        .populate("campaignId", "name")
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Asset.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      data: assets,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      filters: {
        type: type || null,
        userId: userId || null,
        campaignId: campaignId || null,
        search: search || null,
      },
    });
  } catch (error: any) {
    console.error("Error fetching assets:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch assets",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /assets/all - Get all campaigns and direct assets (file manager view)
// ============================================================================

/**
 * GET /api/assets/all
 * 
 * Returns campaigns (folders) first, then direct assets.
 * This is the file manager view matching frontend expectations.
 * 
 * Query Parameters:
 *   - userId: Filter by user ID (required)
 */
router.get("/all", async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    // Get all campaigns with their assets
    const campaigns = await Campaign.find({ userId: userId as string }).sort({ createdAt: -1 }).lean();

    const campaignsWithAssets = await Promise.all(
      campaigns.map(async (campaign) => {
        const assets = await Asset.find({ campaignId: campaign._id })
          .select("_id name type url thumbnail duration size createdAt")
          .sort({ createdAt: -1 })
          .lean();

        return {
          id: campaign._id,
          _id: campaign._id,
          name: campaign.name,
          description: campaign.description,
          type: "campaign" as const,
          itemType: "folder" as const,
          assets: assets.map((asset: any) => ({
            assetId: asset._id,
            _id: asset._id,
            assetName: asset.name,
            name: asset.name,
            fileType: asset.type.toLowerCase(),
            type: asset.type,
            fileUrl: asset.url,
            url: asset.url,
            thumbnail: asset.thumbnail,
            duration: asset.duration || 10,
            size: asset.size,
            createdAt: asset.createdAt,
          })),
          assetCount: assets.length,
          maxAssets: MAX_ASSETS_PER_CAMPAIGN,
          canAddMoreAssets: assets.length < MAX_ASSETS_PER_CAMPAIGN,
          createdAt: campaign.createdAt,
          updatedAt: campaign.updatedAt,
        };
      })
    );

    // Get direct assets (assets without campaignId)
    const directAssets = await Asset.find({
      userId: userId as string,
      campaignId: null,
    })
      .sort({ createdAt: -1 })
      .select("_id name type url size createdAt duration thumbnail")
      .lean();

    const formattedDirectAssets = directAssets.map((asset: any) => ({
      _id: asset._id,
      id: asset._id,
      assetId: asset._id,
      assetName: asset.name,
      name: asset.name,
      fileType: asset.type.toLowerCase(),
      type: asset.type,
      fileUrl: asset.url,
      url: asset.url,
      thumbnail: asset.thumbnail,
      duration: asset.duration || 10,
      size: asset.size || 0,
      createdAt: asset.createdAt,
      itemType: "asset" as const,
    }));

    return res.status(200).json({
      success: true,
      campaigns: campaignsWithAssets,
      assets: formattedDirectAssets,
      // Combined view: folders first, then assets
      items: [...campaignsWithAssets, ...formattedDirectAssets],
    });
  } catch (error: any) {
    console.error("Error fetching all assets:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch assets",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /assets/list - List assets with optional campaign filter
// ============================================================================

/**
 * GET /api/assets/list
 * 
 * List assets with optional campaignId filter.
 * 
 * Query Parameters:
 *   - userId: Filter by user ID (required)
 *   - campaignId: Filter by campaign ID (optional - null for direct assets)
 */
router.get("/list", async (req: Request, res: Response) => {
  try {
    const { userId, campaignId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const filter: Record<string, any> = { userId: userId as string };

    if (campaignId) {
      if (campaignId === "null" || campaignId === "") {
        filter.campaignId = null;
      } else if (mongoose.Types.ObjectId.isValid(campaignId as string)) {
        filter.campaignId = new mongoose.Types.ObjectId(campaignId as string);
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid campaign ID format",
        });
      }
    }

    const assets = await Asset.find(filter)
      .populate("campaignId", "name")
      .sort({ createdAt: -1 })
      .lean();

    // Format response to match frontend expectations
    const formattedAssets = assets.map((asset: any) => ({
      _id: asset._id,
      id: asset._id,
      assetId: asset._id,
      assetName: asset.name,
      name: asset.name,
      fileType: asset.type.toLowerCase(),
      type: asset.type,
      fileUrl: asset.url,
      url: asset.url,
      thumbnail: asset.thumbnail,
      duration: asset.duration || 10,
      size: asset.size || 0,
      campaignId: asset.campaignId?._id || null,
      campaignName: asset.campaignId?.name || null,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      data: formattedAssets,
      count: formattedAssets.length,
    });
  } catch (error: any) {
    console.error("Error listing assets:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to list assets",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// POST /assets/upload - File Upload Endpoint
// ============================================================================

/**
 * POST /api/assets/upload
 * 
 * Upload a file to S3 and create an asset record.
 * Supports images and videos up to 500MB.
 * 
 * Form Data:
 *   - file: The file to upload (required)
 *   - userId: User ID (required)
 *   - campaignId: Campaign ID (optional - null for direct assets)
 *   - name: Asset name (optional - uses filename if not provided)
 *   - thumbnail: Base64 thumbnail for videos (optional)
 */
router.post(
  "/upload",
  (req: Request, res: Response, next: NextFunction) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            success: false,
            message: `File too large. Maximum size is ${formatFileSize(config.upload.maxFileSize)}`,
          });
        }
        if (err.message && err.message.includes("File type not allowed")) {
          return res.status(400).json({
            success: false,
            message: err.message,
          });
        }
        return res.status(400).json({
          success: false,
          message: err.message || "Upload failed",
        });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      // Check if S3 is configured
      if (!isS3Configured()) {
        return res.status(503).json({
          success: false,
          message: "File upload service not configured. Please set AWS credentials.",
        });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          message: "No file provided",
        });
      }

      const { userId, campaignId, name, thumbnail } = req.body;

      // Validate userId
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required",
        });
      }

      // Determine asset type from MIME type
      const assetType = getAssetTypeFromMime(file.mimetype);
      if (!assetType) {
        return res.status(400).json({
          success: false,
          message: `Unsupported file type: ${file.mimetype}`,
          allowedTypes: Object.keys(ALLOWED_MIME_TYPES),
        });
      }

      // Validate campaignId if provided
      let validCampaignId: string | null = null;
      if (campaignId && campaignId !== "null" && campaignId !== "") {
        if (!mongoose.Types.ObjectId.isValid(campaignId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid campaign ID format",
          });
        }

        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
          return res.status(404).json({
            success: false,
            message: "Campaign not found",
          });
        }

        // Check asset count limit
        const assetCount = await Asset.countDocuments({ campaignId });
        if (assetCount >= MAX_ASSETS_PER_CAMPAIGN) {
          return res.status(400).json({
            success: false,
            message: `Maximum ${MAX_ASSETS_PER_CAMPAIGN} assets allowed in one Campaign.`,
          });
        }

        validCampaignId = campaignId;
      }

      // Generate S3 key and upload
      const s3Key = generateS3Key(file.originalname, userId);
      const fileUrl = await uploadToS3(s3Key, file.buffer, file.mimetype);

      // Handle thumbnail upload for videos
      let thumbnailUrl: string | null = null;
      if (assetType === "VIDEO" && thumbnail) {
        try {
          const base64Data = thumbnail.replace(/^data:image\/\w+;base64,/, "");
          const thumbnailBuffer = Buffer.from(base64Data, "base64");
          const thumbnailKey = `${s3Key}_thumb.jpg`;
          thumbnailUrl = await uploadToS3(thumbnailKey, thumbnailBuffer, "image/jpeg");
        } catch (thumbError) {
          console.error("Failed to upload thumbnail:", thumbError);
        }
      }

      // Create asset record
      const asset = new Asset({
        name: name || file.originalname,
        type: assetType,
        url: fileUrl,
        thumbnail: thumbnailUrl,
        duration: assetType === "VIDEO" ? 1 : 10,
        size: file.size,
        userId,
        campaignId: validCampaignId,
      });

      await asset.save();

      if (validCampaignId) {
        await asset.populate("campaignId", "name");
      }

      return res.status(201).json({
        success: true,
        message: "File uploaded successfully",
        asset: {
          _id: asset._id,
          assetId: asset._id,
          assetName: asset.name,
          name: asset.name,
          fileType: assetType.toLowerCase(),
          type: asset.type,
          fileUrl: asset.url,
          url: asset.url,
          thumbnail: asset.thumbnail,
          duration: asset.duration,
          size: asset.size,
          campaignId: asset.campaignId,
          userId: asset.userId,
          createdAt: asset.createdAt,
        },
        signedUrl: null, // Included for frontend compatibility
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to upload file",
        error: config.isDevelopment ? error.message : undefined,
      });
    }
  }
);

// ============================================================================
// GET /assets/stats/summary - Asset Statistics
// ============================================================================

/**
 * GET /api/assets/stats/summary
 * 
 * Returns summary statistics about all assets.
 * NOTE: This route must be before /:id to avoid conflict
 */
router.get("/stats/summary", async (req: Request, res: Response) => {
  try {
    const stats = await Asset.aggregate([
      {
        $group: {
          _id: null,
          totalAssets: { $sum: 1 },
          totalSize: { $sum: "$size" },
          byType: {
            $push: "$type",
          },
        },
      },
      {
        $project: {
          _id: 0,
          totalAssets: 1,
          totalSize: 1,
          totalSizeMB: { $round: [{ $divide: ["$totalSize", 1048576] }, 2] },
        },
      },
    ]);

    // Get count by type
    const typeStats = await Asset.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
          totalSize: { $sum: "$size" },
        },
      },
      {
        $project: {
          _id: 0,
          type: "$_id",
          count: 1,
          totalSize: 1,
          totalSizeMB: { $round: [{ $divide: ["$totalSize", 1048576] }, 2] },
        },
      },
    ]);

    // Get count by campaign
    const campaignStats = await Asset.aggregate([
      {
        $group: {
          _id: "$campaignId",
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "campaigns",
          localField: "_id",
          foreignField: "_id",
          as: "campaign",
        },
      },
      {
        $unwind: { path: "$campaign", preserveNullAndEmptyArrays: true },
      },
      {
        $project: {
          _id: 0,
          campaignId: "$_id",
          campaignName: "$campaign.name",
          assetCount: "$count",
          maxAssets: { $literal: MAX_ASSETS_PER_CAMPAIGN },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      stats: stats[0] || { totalAssets: 0, totalSize: 0, totalSizeMB: 0 },
      byType: typeStats,
      byCampaign: campaignStats,
    });
  } catch (error: any) {
    console.error("Error fetching asset stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch asset statistics",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /assets/by-name/:name - Get Asset by Name
// ============================================================================

/**
 * GET /api/assets/by-name/:name
 * 
 * Gets an asset by its name (useful for players that know asset names but not IDs).
 */
router.get("/by-name/:name", async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    const asset = await Asset.findOne({ name })
      .populate("campaignId", "name")
      .lean();

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: asset,
    });
  } catch (error: any) {
    console.error("Error fetching asset by name:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch asset",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /assets/:id - Get Single Asset
// ============================================================================

/**
 * GET /api/assets/:id
 * 
 * Gets a single asset by its ID.
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid asset ID format",
      });
    }

    const asset = await Asset.findById(id)
      .populate("campaignId", "name")
      .lean();

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: asset,
    });
  } catch (error: any) {
    console.error("Error fetching asset:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch asset",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /assets/:id/download - Download/Redirect to Asset
// ============================================================================

/**
 * GET /api/assets/:id/download
 * 
 * Redirects to the asset's URL for download.
 * Useful for tracking downloads or adding access control.
 * 
 * Query Parameters:
 *   - redirect: If "false", returns URL in JSON instead of redirecting
 */
router.get("/:id/download", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { redirect = "true" } = req.query;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid asset ID format",
      });
    }

    const asset = await Asset.findById(id).lean() as any;

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    // If redirect=false, return URL in JSON
    if (redirect === "false") {
      return res.status(200).json({
        success: true,
        data: {
          id: asset._id,
          name: asset.name,
          type: asset.type,
          url: asset.url,
          size: asset.size,
          downloadUrl: asset.url,
        },
      });
    }

    // Redirect to the asset URL
    return res.redirect(asset.url);
  } catch (error: any) {
    console.error("Error downloading asset:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download asset",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// POST /assets - Create New Asset
// ============================================================================

/**
 * POST /api/assets
 * 
 * Creates a new asset record.
 * 
 * VALIDATION RULES:
 * - campaignId is OPTIONAL - null/empty means direct asset
 * - If campaignId is provided, max 9 assets per campaign
 * - name/description NOT required for assets (uses filename by default)
 * 
 * Note: This creates the metadata only. Actual file upload should be 
 * handled separately (e.g., to S3, CloudFlare, etc.)
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const assetData: CreateAssetInput = req.body;

    // Validate required fields (campaignId is NOT required for direct assets)
    const requiredFields = ["name", "type", "url", "userId"];
    const missingFields = requiredFields.filter(
      (field) => !assetData[field as keyof CreateAssetInput]
    );

    if (missingFields.length > 0) {
        return res.status(400).json({
          success: false,
        message: `Missing required fields: ${missingFields.join(", ")}`,
        });
      }

    // Validate asset type
    const validTypes = ["IMAGE", "VIDEO", "HTML", "URL"];
    if (!validTypes.includes(assetData.type.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid asset type. Must be one of: ${validTypes.join(", ")}`,
      });
    }

    // Determine if this is a campaign asset or direct asset
    let validCampaignId: string | null = null;
    let campaign: any = null;
    let currentAssetCount = 0;

    // If campaignId is provided and not empty/null, validate it
    if (assetData.campaignId && assetData.campaignId !== "null" && assetData.campaignId !== "") {
    // Validate campaignId format
    if (!mongoose.Types.ObjectId.isValid(assetData.campaignId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign ID format",
      });
    }

    // Validate campaign exists
      campaign = await Campaign.findById(assetData.campaignId);
    if (!campaign) {
      return res.status(404).json({
        success: false,
          message: "Campaign not found",
      });
    }

    // Check asset count limit for this campaign
      currentAssetCount = await Asset.countDocuments({
      campaignId: assetData.campaignId,
    });

    if (currentAssetCount >= MAX_ASSETS_PER_CAMPAIGN) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_ASSETS_PER_CAMPAIGN} assets allowed in one Campaign.`,
        currentCount: currentAssetCount,
        maxAllowed: MAX_ASSETS_PER_CAMPAIGN,
      });
    }

      validCampaignId = assetData.campaignId;
    }

    // Create asset (campaignId will be null for direct assets)
    const asset = new Asset({
      name: assetData.name,
      type: assetData.type.toUpperCase(),
      url: assetData.url,
      thumbnail: assetData.thumbnail || null,
      duration: assetData.duration || null,
      size: assetData.size || 0,
      userId: assetData.userId,
      campaignId: validCampaignId,
    });

    await asset.save();

    // Populate campaign info for response (if applicable)
    if (validCampaignId) {
    await asset.populate("campaignId", "name");
    }

    // Build response
    const response: any = {
      success: true,
      message: validCampaignId ? "Asset added to campaign successfully" : "Direct asset created successfully",
      data: asset,
    };

    // Add campaign info if asset belongs to a campaign
    if (campaign) {
      response.campaignInfo = {
        campaignId: campaign._id,
        campaignName: campaign.name,
        assetCount: currentAssetCount + 1,
        maxAssets: MAX_ASSETS_PER_CAMPAIGN,
        remainingSlots: MAX_ASSETS_PER_CAMPAIGN - (currentAssetCount + 1),
      };
    }

    return res.status(201).json(response);
  } catch (error: any) {
    console.error("Error creating asset:", error);

    // Handle duplicate name error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Asset with this name already exists",
      });
    }

    // Handle validation errors
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e: any) => e.message);
      return res.status(400).json({
        success: false,
        message: messages.join(". "),
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create asset",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// PUT /assets/:id - Update Asset
// ============================================================================

/**
 * PUT /api/assets/:id
 * 
 * Updates an existing asset.
 * Note: Changing campaignId requires validation of the new campaign's asset limit.
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid asset ID format",
      });
    }

    // Get existing asset
    const existingAsset = await Asset.findById(id);
    if (!existingAsset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    // If changing campaignId, validate the new campaign
    if (updateData.campaignId && updateData.campaignId !== existingAsset.campaignId.toString()) {
      if (!mongoose.Types.ObjectId.isValid(updateData.campaignId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid campaign ID format",
        });
      }

      // Check if new campaign exists
      const newCampaign = await Campaign.findById(updateData.campaignId);
      if (!newCampaign) {
        return res.status(404).json({
          success: false,
          message: "Target campaign not found",
        });
      }

      // Check asset count limit for new campaign
      const newCampaignAssetCount = await Asset.countDocuments({
        campaignId: updateData.campaignId,
      });

      if (newCampaignAssetCount >= MAX_ASSETS_PER_CAMPAIGN) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${MAX_ASSETS_PER_CAMPAIGN} assets allowed in one Campaign. Target campaign is full.`,
          currentCount: newCampaignAssetCount,
          maxAllowed: MAX_ASSETS_PER_CAMPAIGN,
        });
      }
    }

    // Validate asset type if provided
    if (updateData.type) {
      const validTypes = ["IMAGE", "VIDEO", "HTML", "URL"];
      if (!validTypes.includes(updateData.type.toUpperCase())) {
        return res.status(400).json({
          success: false,
          message: `Invalid asset type. Must be one of: ${validTypes.join(", ")}`,
        });
      }
      updateData.type = updateData.type.toUpperCase();
    }

    const asset = await Asset.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .populate("campaignId", "name")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Asset updated successfully",
      data: asset,
    });
  } catch (error: any) {
    console.error("Error updating asset:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update asset",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// DELETE /assets/:id - Delete Asset
// ============================================================================

/**
 * DELETE /api/assets/:id
 * 
 * Deletes an asset by ID.
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid asset ID format",
      });
    }

    const asset = await Asset.findByIdAndDelete(id).lean() as any;

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Asset deleted successfully",
      data: { id: asset._id },
    });
  } catch (error: any) {
    console.error("Error deleting asset:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete asset",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Export the router
export const assetRoutes = router;
