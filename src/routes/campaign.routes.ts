import { Router, Request, Response } from "express";
import Campaign from "../models/Campaign";
import Asset from "../models/Asset";
import Playlist from "../models/Playlist";
import mongoose from "mongoose";

/**
 * Campaign Routes
 * 
 * This module provides API endpoints for:
 * 1. Creating campaigns (requires userId)
 * 2. Listing all campaigns with asset counts
 * 3. Getting a single campaign with its assets
 * 4. Deleting campaigns (with validation)
 * 
 * Note: userId filter is optional for GET requests but required for POST
 */

const router = Router();

// ============================================================================
// Constants
// ============================================================================

const MAX_ASSETS_PER_CAMPAIGN = 9;

// ============================================================================
// Types & Interfaces
// ============================================================================

interface CampaignQuery {
  userId?: string;
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

interface CreateCampaignInput {
  name: string;
  description?: string;
  userId: string;
}

// ============================================================================
// GET /campaigns - List All Campaigns
// ============================================================================

/**
 * GET /api/campaigns
 * 
 * Lists all campaigns with pagination, search, and asset counts.
 * 
 * Query Parameters:
 *   - userId: Filter by user ID (optional)
 *   - search: Search by name (case-insensitive)
 *   - page: Page number (default: 1)
 *   - limit: Results per page (default: 20, max: 100)
 *   - sortBy: Field to sort by (default: createdAt)
 *   - sortOrder: asc or desc (default: desc)
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      userId,
      search,
      page = "1",
      limit = "20",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as CampaignQuery;

    // Parse pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Build query filter
    const filter: Record<string, any> = {};

    // Filter by userId if provided
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
    const [campaigns, totalCount] = await Promise.all([
      Campaign.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Campaign.countDocuments(filter),
    ]);

    // Get asset counts for each campaign
    const campaignIds = campaigns.map(c => c._id);
    const assetCounts = await Asset.aggregate([
      {
        $match: {
          campaignId: { $in: campaignIds },
        },
      },
      {
        $group: {
          _id: "$campaignId",
          count: { $sum: 1 },
          assets: {
            $push: {
              _id: "$_id",
              name: "$name",
              type: "$type",
              thumbnail: "$thumbnail",
              url: "$url",
            },
          },
        },
      },
    ]);

    // Create a map for quick lookup
    const assetCountMap = new Map(
      assetCounts.map(item => [item._id.toString(), {
        count: item.count,
        assets: item.assets.slice(0, 4), // Preview thumbnails (max 4)
      }])
    );

    // Add asset info to campaigns
    const campaignsWithAssets = campaigns.map(campaign => {
      const campaignIdStr = (campaign._id as mongoose.Types.ObjectId).toString();
      return {
        ...campaign,
        assetCount: assetCountMap.get(campaignIdStr)?.count || 0,
        maxAssets: MAX_ASSETS_PER_CAMPAIGN,
        previewAssets: assetCountMap.get(campaignIdStr)?.assets || [],
        canAddMoreAssets: (assetCountMap.get(campaignIdStr)?.count || 0) < MAX_ASSETS_PER_CAMPAIGN,
      };
    });

    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      data: campaignsWithAssets,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      filters: {
        userId: userId || null,
        search: search || null,
      },
    });
  } catch (error: any) {
    console.error("Error fetching campaigns:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch campaigns",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /campaigns/:id - Get Single Campaign with Assets
// ============================================================================

/**
 * GET /api/campaigns/:id
 * 
 * Gets a single campaign by ID with all its assets.
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign ID format",
      });
    }

    const campaign = await Campaign.findById(id).lean();

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    // Get all assets in this campaign
    const assets = await Asset.find({ campaignId: id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        ...campaign,
        assets,
        assetCount: assets.length,
        maxAssets: MAX_ASSETS_PER_CAMPAIGN,
        canAddMoreAssets: assets.length < MAX_ASSETS_PER_CAMPAIGN,
      },
    });
  } catch (error: any) {
    console.error("Error fetching campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch campaign",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// POST /campaigns/create - Create New Campaign (alias for frontend compatibility)
// ============================================================================

/**
 * POST /api/campaigns/create (or POST /api/campaign/create)
 * 
 * Alias for POST /api/campaigns for frontend compatibility.
 */
router.post("/create", async (req: Request, res: Response) => {
  try {
    const { name, description, userId }: CreateCampaignInput = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Campaign name is required",
        message: "Campaign name is required",
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "User ID is required",
        message: "User ID is required",
      });
    }

    const trimmedName = name.trim();

    // Check for duplicate
    const existingCampaign = await Campaign.findOne({
      name: trimmedName,
      userId: userId,
    });

    if (existingCampaign) {
      return res.status(400).json({
        success: false,
        error: "A campaign with this name already exists",
        message: "A campaign with this name already exists",
      });
    }

    const campaign = new Campaign({
      name: trimmedName,
      description: description?.trim() || "",
      userId: userId,
    });

    await campaign.save();

    // Return format matching frontend expectations
    return res.status(201).json({
      id: campaign._id,
      _id: campaign._id,
      name: campaign.name,
      description: campaign.description,
      type: "campaign",
      assets: [],
      assetCount: 0,
      maxAssets: MAX_ASSETS_PER_CAMPAIGN,
      canAddMoreAssets: true,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    });
  } catch (error: any) {
    console.error("Error creating campaign:", error);

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        error: "A campaign with this name already exists",
        message: "A campaign with this name already exists",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to create campaign",
      message: "Failed to create campaign",
    });
  }
});

// ============================================================================
// POST /campaigns - Create New Campaign
// ============================================================================

/**
 * POST /api/campaigns
 * 
 * Creates a new campaign.
 * Campaign name must be unique per user.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, description, userId }: CreateCampaignInput = req.body;

    // Validate required fields
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Campaign name is required",
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const trimmedName = name.trim();

    // Check if campaign name already exists for this user
    const existingCampaign = await Campaign.findOne({
      name: trimmedName,
      userId: userId,
    });

    if (existingCampaign) {
      return res.status(409).json({
        success: false,
        message: "A campaign with this name already exists",
      });
    }

    // Create campaign
    const campaign = new Campaign({
      name: trimmedName,
      description: description?.trim() || "",
      userId: userId,
    });

    await campaign.save();

    return res.status(201).json({
      success: true,
      message: "Campaign created successfully",
      data: {
        ...campaign.toObject(),
        assetCount: 0,
        maxAssets: MAX_ASSETS_PER_CAMPAIGN,
        assets: [],
        previewAssets: [],
        canAddMoreAssets: true,
      },
    });
  } catch (error: any) {
    console.error("Error creating campaign:", error);

    // Handle duplicate name error from MongoDB
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A campaign with this name already exists",
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
      message: "Failed to create campaign",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// PUT /campaigns/:id - Update Campaign
// ============================================================================

/**
 * PUT /api/campaigns/:id
 * 
 * Updates an existing campaign.
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign ID format",
      });
    }

    // Get existing campaign
    const existingCampaign = await Campaign.findById(id);
    if (!existingCampaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    // Build update object
    const updateData: Partial<{ name: string; description: string }> = {};

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (trimmedName.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Campaign name cannot be empty",
        });
      }

      // Check for duplicate name within same user (excluding current campaign)
      if (trimmedName !== existingCampaign.name) {
        const duplicateCampaign = await Campaign.findOne({
          name: trimmedName,
          userId: existingCampaign.userId,
          _id: { $ne: id },
        });

        if (duplicateCampaign) {
          return res.status(409).json({
            success: false,
            message: "A campaign with this name already exists",
          });
        }
      }

      updateData.name = trimmedName;
    }

    if (description !== undefined) {
      updateData.description = description.trim();
    }

    const campaign = await Campaign.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).lean();

    // Get asset count
    const assetCount = await Asset.countDocuments({ campaignId: id });

    return res.status(200).json({
      success: true,
      message: "Campaign updated successfully",
      data: {
        ...campaign,
        assetCount,
        maxAssets: MAX_ASSETS_PER_CAMPAIGN,
        canAddMoreAssets: assetCount < MAX_ASSETS_PER_CAMPAIGN,
      },
    });
  } catch (error: any) {
    console.error("Error updating campaign:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A campaign with this name already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update campaign",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// DELETE /campaigns/:id - Delete Campaign
// ============================================================================

/**
 * DELETE /api/campaigns/:id
 * 
 * Deletes a campaign by ID.
 * Cannot delete if campaign is assigned to any playlist.
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign ID format",
      });
    }

    // Check if campaign exists
    const campaign = await Campaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    // Check if campaign is assigned to any playlist
    const playlistsUsingCampaign = await Playlist.findOne({
      campaignIds: id,
    });

    if (playlistsUsingCampaign) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete campaign. It is currently assigned to a playlist. Remove it from the playlist first.",
      });
    }

    // Delete all assets in this campaign
    const deletedAssets = await Asset.deleteMany({ campaignId: id });

    // Delete the campaign
    await Campaign.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Campaign deleted successfully",
      data: {
        id: campaign._id,
        name: campaign.name,
        deletedAssetsCount: deletedAssets.deletedCount,
      },
    });
  } catch (error: any) {
    console.error("Error deleting campaign:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete campaign",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /campaigns/:id/assets - Get Assets in Campaign
// ============================================================================

/**
 * GET /api/campaigns/:id/assets
 * 
 * Gets all assets belonging to a specific campaign.
 */
router.get("/:id/assets", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign ID format",
      });
    }

    // Check if campaign exists
    const campaign = await Campaign.findById(id).lean();
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    // Get all assets in this campaign
    const assets = await Asset.find({ campaignId: id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        campaign: {
          _id: (campaign as any)._id,
          name: (campaign as any).name,
        },
        assets,
        assetCount: assets.length,
        maxAssets: MAX_ASSETS_PER_CAMPAIGN,
        canAddMoreAssets: assets.length < MAX_ASSETS_PER_CAMPAIGN,
      },
    });
  } catch (error: any) {
    console.error("Error fetching campaign assets:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch campaign assets",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Export the router
export const campaignRoutes = router;
