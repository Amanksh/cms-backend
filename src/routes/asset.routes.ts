import { Router, Request, Response } from "express";
import Asset, { IAsset } from "../models/Asset";
import mongoose from "mongoose";

/**
 * Asset Routes
 * 
 * This module provides API endpoints for:
 * 1. Listing all assets with pagination and filtering
 * 2. Getting a single asset by ID
 * 3. Getting asset download URL / redirecting to asset
 * 4. Creating new assets (metadata)
 * 5. Updating assets
 * 6. Deleting assets
 */

const router = Router();

// ============================================================================
// Types & Interfaces
// ============================================================================

interface AssetQuery {
  type?: string;
  userId?: string;
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

interface CreateAssetInput {
  name: string;
  type: "IMAGE" | "VIDEO" | "HTML" | "URL";
  url: string;
  thumbnail?: string;
  duration?: number;
  size: number;
  userId: string;
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
 *   - type: Filter by asset type (IMAGE, VIDEO, HTML, URL)
 *   - userId: Filter by user ID
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
      search,
      page = "1",
      limit = "20",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as AssetQuery;

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

    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }

    // Build sort options
    const sortOptions: Record<string, 1 | -1> = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Execute queries in parallel
    const [assets, totalCount] = await Promise.all([
      Asset.find(filter)
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

    const asset = await Asset.findById(id).lean();

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

    const asset = await Asset.findById(id).lean();

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

    const asset = await Asset.findOne({ name }).lean();

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
// POST /assets - Create New Asset
// ============================================================================

/**
 * POST /api/assets
 * 
 * Creates a new asset record.
 * Note: This creates the metadata only. Actual file upload should be 
 * handled separately (e.g., to S3, CloudFlare, etc.)
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const assetData: CreateAssetInput = req.body;

    // Validate required fields
    const requiredFields = ["name", "type", "url", "size", "userId"];
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

    // Create asset
    const asset = new Asset({
      name: assetData.name,
      type: assetData.type.toUpperCase(),
      url: assetData.url,
      thumbnail: assetData.thumbnail || null,
      duration: assetData.duration || null,
      size: assetData.size,
      userId: assetData.userId,
    });

    await asset.save();

    return res.status(201).json({
      success: true,
      message: "Asset created successfully",
      data: asset,
    });
  } catch (error: any) {
    console.error("Error creating asset:", error);

    // Handle duplicate name error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Asset with this name already exists",
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
    ).lean();

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

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

    const asset = await Asset.findByIdAndDelete(id).lean();

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

// ============================================================================
// GET /assets/stats/summary - Asset Statistics
// ============================================================================

/**
 * GET /api/assets/stats/summary
 * 
 * Returns summary statistics about all assets.
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

    return res.status(200).json({
      success: true,
      stats: stats[0] || { totalAssets: 0, totalSize: 0, totalSizeMB: 0 },
      byType: typeStats,
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

// Export the router
export const assetRoutes = router;

