import { Router, Request, Response } from "express";
import Playlist from "../models/Playlist";
import Campaign from "../models/Campaign";
import Asset from "../models/Asset";
import mongoose from "mongoose";

/**
 * Playlist Routes
 * 
 * This module provides API endpoints for:
 * 1. Creating playlists with campaigns AND/OR direct assets
 * 2. Listing all playlists
 * 3. Getting a single playlist with expanded campaigns and assets
 * 4. Updating playlists (adding/removing campaigns/assets)
 * 5. Deleting playlists
 * 
 * Key validation rules:
 * - Maximum 7 campaigns per playlist
 * - Campaigns are expanded to show their assets when fetched
 * - Direct assets (assetIds) are also supported
 */

const router = Router();

// ============================================================================
// Constants
// ============================================================================

const MAX_CAMPAIGNS_PER_PLAYLIST = 7;

// ============================================================================
// Types & Interfaces
// ============================================================================

interface PlaylistQuery {
  userId?: string;
  status?: string;
  search?: string;
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

interface CreatePlaylistInput {
  name: string;
  description?: string;
  userId: string;
  status?: "active" | "inactive" | "scheduled";
  campaignIds?: string[];
  assetIds?: string[]; // Direct assets support
  schedule?: {
    startDate: Date;
    endDate: Date;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  };
}

// ============================================================================
// GET /playlists - List All Playlists
// ============================================================================

/**
 * GET /api/playlists
 * 
 * Lists all playlists with pagination, filtering, and campaign/asset counts.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      userId,
      status,
      search,
      page = "1",
      limit = "20",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query as PlaylistQuery;

    // Parse pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Build query filter
    const filter: Record<string, any> = {};

    if (userId) {
      filter.userId = userId;
    }

    if (status) {
      filter.status = status;
    }

    if (search) {
      filter.name = { $regex: search, $options: "i" };
    }

    // Build sort options
    const sortOptions: Record<string, 1 | -1> = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Execute queries in parallel
    const [playlists, totalCount] = await Promise.all([
      Playlist.find(filter)
        .populate({
          path: "campaignIds",
          select: "name description createdAt",
        })
        .populate({
          path: "assetIds",
          select: "name type url thumbnail duration size",
        })
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Playlist.countDocuments(filter),
    ]) as [any[], number];

    // Get asset counts for each campaign in the playlists
    const allCampaignIds = playlists.flatMap(p => 
      (p.campaignIds || []).map((c: any) => c._id)
    );

    const assetCounts = await Asset.aggregate([
      {
        $match: {
          campaignId: { $in: allCampaignIds },
        },
      },
      {
        $group: {
          _id: "$campaignId",
          count: { $sum: 1 },
        },
      },
    ]);

    const assetCountMap = new Map(
      assetCounts.map(item => [item._id.toString(), item.count])
    );

    // Enhance playlists with campaign info and direct asset counts
    const enhancedPlaylists = playlists.map(playlist => {
      const campaignAssetCount = (playlist.campaignIds || []).reduce(
        (sum: number, campaign: any) => sum + (assetCountMap.get(campaign._id.toString()) || 0),
        0
      );
      const directAssetCount = (playlist.assetIds || []).length;

      return {
      ...playlist,
      campaigns: (playlist.campaignIds || []).map((campaign: any) => ({
        ...campaign,
        assetCount: assetCountMap.get(campaign._id.toString()) || 0,
      })),
        directAssets: playlist.assetIds || [],
      campaignCount: (playlist.campaignIds || []).length,
        directAssetCount,
      maxCampaigns: MAX_CAMPAIGNS_PER_PLAYLIST,
        totalAssetCount: campaignAssetCount + directAssetCount,
      };
    });

    const totalPages = Math.ceil(totalCount / limitNum);

    return res.status(200).json({
      success: true,
      data: enhancedPlaylists,
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
        status: status || null,
        search: search || null,
      },
    });
  } catch (error: any) {
    console.error("Error fetching playlists:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch playlists",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /playlists/:id - Get Single Playlist with Expanded Campaigns
// ============================================================================

/**
 * Helper function to expand campaigns and collect all assets
 * Returns a flattened array of all assets from campaigns and direct assets
 */
async function expandPlaylistAssets(playlist: any): Promise<{
  finalAssets: any[];
  campaignAssets: any[];
  directAssets: any[];
  debugLogs: string[];
}> {
  const debugLogs: string[] = [];
  const finalAssets: any[] = [];
  const seenAssetIds = new Set<string>();

  debugLogs.push(`[PLAYLIST_EXPAND] Starting asset expansion for playlist: ${playlist._id}`);
  debugLogs.push(`[PLAYLIST_EXPAND] Playlist has ${playlist.campaignIds?.length || 0} campaigns and ${playlist.assetIds?.length || 0} direct assets`);

  // 1. Expand campaigns and collect all assets
  const campaignAssets: any[] = [];
  if (playlist.campaignIds && Array.isArray(playlist.campaignIds) && playlist.campaignIds.length > 0) {
    debugLogs.push(`[PLAYLIST_EXPAND] Processing ${playlist.campaignIds.length} campaigns...`);
    
    for (let i = 0; i < playlist.campaignIds.length; i++) {
      const campaignId = playlist.campaignIds[i];
      
      // Handle both ObjectId and populated campaign objects
      let campaignIdStr: string;
      if (campaignId && typeof campaignId === 'object' && campaignId._id) {
        // Populated campaign object
        campaignIdStr = campaignId._id.toString();
      } else if (campaignId && typeof campaignId.toString === 'function') {
        // ObjectId
        campaignIdStr = campaignId.toString();
      } else if (typeof campaignId === 'string') {
        // String ID
        campaignIdStr = campaignId;
      } else {
        debugLogs.push(`[PLAYLIST_EXPAND] WARNING: Invalid campaign ID format at index ${i}, skipping`);
        continue;
      }
      
      // Validate ObjectId format
      if (!mongoose.Types.ObjectId.isValid(campaignIdStr)) {
        debugLogs.push(`[PLAYLIST_EXPAND] WARNING: Invalid ObjectId format: ${campaignIdStr}, skipping`);
        continue;
      }
      
      debugLogs.push(`[PLAYLIST_EXPAND] Campaign ${i + 1}/${playlist.campaignIds.length}: ${campaignIdStr}`);
      
      try {
        // Fetch campaign to verify it exists
        const campaign = await Campaign.findById(campaignIdStr).lean() as any;
        if (!campaign) {
          debugLogs.push(`[PLAYLIST_EXPAND] WARNING: Campaign ${campaignIdStr} not found, skipping`);
          continue;
        }
        
        debugLogs.push(`[PLAYLIST_EXPAND] Campaign found: ${campaign.name || 'Unnamed'}`);
        
        // Fetch all assets in this campaign - use ObjectId for query
        const campaignObjectId = new mongoose.Types.ObjectId(campaignIdStr);
        const assets = await Asset.find({ campaignId: campaignObjectId })
          .select("_id name type url thumbnail duration size createdAt")
          .sort({ createdAt: 1 })
          .lean() as any[];
        
        debugLogs.push(`[PLAYLIST_EXPAND] Found ${assets.length} assets in campaign ${campaign.name || campaignIdStr}`);
        
        // Add assets to campaignAssets array and finalAssets (avoiding duplicates)
        for (const asset of assets) {
          if (!asset || !asset._id) {
            debugLogs.push(`[PLAYLIST_EXPAND] WARNING: Invalid asset object, skipping`);
            continue;
          }
          
          const assetIdStr = asset._id.toString();
          
          if (!seenAssetIds.has(assetIdStr)) {
            seenAssetIds.add(assetIdStr);
            campaignAssets.push(asset);
            finalAssets.push({
              assetId: assetIdStr,
              name: asset.name || 'Unnamed Asset',
              type: asset.type || 'IMAGE',
              url: asset.url || '',
              thumbnail: asset.thumbnail || null,
              duration: asset.duration || (asset.type === 'VIDEO' ? 0 : 10),
              size: asset.size || null,
              createdAt: asset.createdAt || new Date(),
            });
            debugLogs.push(`[PLAYLIST_EXPAND] Added asset: ${asset.name || assetIdStr} (${asset.type})`);
          } else {
            debugLogs.push(`[PLAYLIST_EXPAND] Skipped duplicate asset: ${asset.name || assetIdStr}`);
          }
        }
      } catch (error: any) {
        debugLogs.push(`[PLAYLIST_EXPAND] ERROR processing campaign ${campaignIdStr}: ${error.message}`);
        console.error(`Error fetching campaign ${campaignIdStr}:`, error);
      }
    }
  } else {
    debugLogs.push(`[PLAYLIST_EXPAND] No campaigns in playlist`);
  }

  // 2. Add direct assets (standalone assets not in any campaign)
  const directAssets: any[] = [];
  if (playlist.assetIds && Array.isArray(playlist.assetIds) && playlist.assetIds.length > 0) {
    debugLogs.push(`[PLAYLIST_EXPAND] Processing ${playlist.assetIds.length} direct assets...`);
    
    // Convert assetIds to ObjectIds for query
    const assetObjectIds = playlist.assetIds
      .map((aid: any) => {
        if (aid && typeof aid === 'object' && aid._id) {
          return new mongoose.Types.ObjectId(aid._id.toString());
        } else if (aid && typeof aid.toString === 'function') {
          return new mongoose.Types.ObjectId(aid.toString());
        } else if (typeof aid === 'string' && mongoose.Types.ObjectId.isValid(aid)) {
          return new mongoose.Types.ObjectId(aid);
        }
        return null;
      })
      .filter((id: any) => id !== null);
    
    if (assetObjectIds.length === 0) {
      debugLogs.push(`[PLAYLIST_EXPAND] No valid direct asset IDs found`);
    } else {
      const directAssetsData = await Asset.find({
        _id: { $in: assetObjectIds },
      })
        .select("_id name type url thumbnail duration size createdAt")
        .sort({ createdAt: 1 })
        .lean() as any[];

      debugLogs.push(`[PLAYLIST_EXPAND] Found ${directAssetsData.length} direct assets in database`);

      for (const asset of directAssetsData) {
        if (!asset || !asset._id) {
          debugLogs.push(`[PLAYLIST_EXPAND] WARNING: Invalid direct asset object, skipping`);
          continue;
        }
        
        const assetIdStr = asset._id.toString();
        
        if (!seenAssetIds.has(assetIdStr)) {
          seenAssetIds.add(assetIdStr);
          directAssets.push(asset);
          finalAssets.push({
            assetId: assetIdStr,
            name: asset.name || 'Unnamed Asset',
            type: asset.type || 'IMAGE',
            url: asset.url || '',
            thumbnail: asset.thumbnail || null,
            duration: asset.duration || (asset.type === 'VIDEO' ? 0 : 10),
            size: asset.size || null,
            createdAt: asset.createdAt || new Date(),
          });
          debugLogs.push(`[PLAYLIST_EXPAND] Added direct asset: ${asset.name || assetIdStr} (${asset.type})`);
        } else {
          debugLogs.push(`[PLAYLIST_EXPAND] Skipped duplicate direct asset: ${asset.name || assetIdStr}`);
        }
      }
    }
  } else {
    debugLogs.push(`[PLAYLIST_EXPAND] No direct assets in playlist`);
  }

  // 3. Legacy support: If no campaigns/direct assets but has items, use items
  if (finalAssets.length === 0 && playlist.items && playlist.items.length > 0) {
    debugLogs.push(`[PLAYLIST_EXPAND] No campaign/direct assets found, checking legacy items...`);
    debugLogs.push(`[PLAYLIST_EXPAND] Found ${playlist.items.length} legacy items`);
    
    for (const item of playlist.items) {
      if (item.assetId) {
        try {
          const asset = await Asset.findById(item.assetId).lean() as any;
          if (asset) {
            const assetIdStr = asset._id.toString();
            if (!seenAssetIds.has(assetIdStr)) {
              seenAssetIds.add(assetIdStr);
              finalAssets.push({
                assetId: assetIdStr,
                name: asset.name,
                type: asset.type,
                url: asset.url,
                thumbnail: asset.thumbnail,
                duration: item.duration || asset.duration,
                size: asset.size,
                createdAt: asset.createdAt,
              });
              debugLogs.push(`[PLAYLIST_EXPAND] Added legacy item asset: ${asset.name || assetIdStr}`);
            }
          }
        } catch (error: any) {
          debugLogs.push(`[PLAYLIST_EXPAND] ERROR fetching legacy asset ${item.assetId}: ${error.message}`);
        }
      }
    }
  }

  debugLogs.push(`[PLAYLIST_EXPAND] Final asset count: ${finalAssets.length} (${campaignAssets.length} from campaigns, ${directAssets.length} direct)`);
  
  return {
    finalAssets,
    campaignAssets,
    directAssets,
    debugLogs,
  };
}

/**
 * GET /api/playlists/:id
 * 
 * Gets a single playlist by ID with all campaigns, their assets, and direct assets expanded.
 * Now includes finalAssets array with all flattened assets.
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    console.log(`[PLAYLIST_FETCH] Fetching playlist: ${id}`);

    const playlist = await Playlist.findById(id)
      .populate({
        path: "campaignIds",
        select: "name description createdAt updatedAt",
      })
      .populate({
        path: "assetIds",
        select: "name type url thumbnail duration size createdAt",
      })
      .lean() as any;

    if (!playlist) {
      console.log(`[PLAYLIST_FETCH] Playlist ${id} not found`);
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    console.log(`[PLAYLIST_FETCH] Playlist found: ${playlist.name}`);
    console.log(`[PLAYLIST_FETCH] Campaigns: ${playlist.campaignIds?.length || 0}, Direct assets: ${playlist.assetIds?.length || 0}`);

    // Expand campaigns and collect all assets
    const { finalAssets, debugLogs } = await expandPlaylistAssets(playlist);

    // Log all debug information
    debugLogs.forEach(log => console.log(log));

    console.log(`[PLAYLIST_FETCH] Returning playlist with ${finalAssets.length} final assets`);
    
    // Validate that we have assets when campaigns exist
    if (playlist.campaignIds && playlist.campaignIds.length > 0 && finalAssets.length === 0) {
      console.warn(`[PLAYLIST_FETCH] WARNING: Playlist has ${playlist.campaignIds.length} campaigns but no assets found!`);
    }

    // Return the simplified format as requested: { playlistId, name, assets: finalAssets }
    return res.status(200).json({
      playlistId: playlist._id.toString(),
      name: playlist.name || 'Unnamed Playlist',
      assets: finalAssets, // Final merged asset list (campaigns + direct, no duplicates)
    });
  } catch (error: any) {
    console.error("[PLAYLIST_FETCH] Error fetching playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// POST /playlists - Create New Playlist
// ============================================================================

/**
 * POST /api/playlists
 * 
 * Creates a new playlist with selected campaigns AND/OR direct assets.
 * Maximum 7 campaigns per playlist.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const playlistData: CreatePlaylistInput = req.body;

    // Validate required fields
    if (!playlistData.name || typeof playlistData.name !== "string" || playlistData.name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Playlist name is required",
      });
    }

    if (!playlistData.userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Normalize and validate campaignIds - ensure only IDs are stored (no nested objects)
    let validatedCampaignIds: mongoose.Types.ObjectId[] = [];

    if (playlistData.campaignIds && Array.isArray(playlistData.campaignIds) && playlistData.campaignIds.length > 0) {
      // Extract only IDs (handle both string IDs and potential nested objects)
      const extractedIds = playlistData.campaignIds.map((item: any) => {
        // If it's already a string ID, use it
        if (typeof item === "string") {
          return item;
        }
        // If it's an object with _id, extract the _id
        if (item && typeof item === "object" && item._id) {
          return item._id;
        }
        // Otherwise, try to convert to string
        return String(item);
      }).filter((id: string) => mongoose.Types.ObjectId.isValid(id));

      // Check max limit
      if (extractedIds.length > MAX_CAMPAIGNS_PER_PLAYLIST) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${MAX_CAMPAIGNS_PER_PLAYLIST} campaigns allowed in one playlist.`,
          provided: extractedIds.length,
          maxAllowed: MAX_CAMPAIGNS_PER_PLAYLIST,
        });
      }

      // Verify all campaigns exist
      const existingCampaigns = await Campaign.find({
        _id: { $in: extractedIds },
      }).select("_id");

      const existingIds = new Set(existingCampaigns.map(c => c._id.toString()));
      const missingIds = extractedIds.filter((id: string) => !existingIds.has(id));

      if (missingIds.length > 0) {
        return res.status(404).json({
          success: false,
          message: `Some campaigns not found: ${missingIds.join(", ")}`,
        });
      }

      // Convert to ObjectIds - store ONLY IDs, no nested objects
      validatedCampaignIds = extractedIds.map((id: string) => new mongoose.Types.ObjectId(id));
    }

    // Normalize and validate assetIds - ensure only IDs are stored (no nested objects)
    let validatedAssetIds: mongoose.Types.ObjectId[] = [];

    if (playlistData.assetIds && Array.isArray(playlistData.assetIds) && playlistData.assetIds.length > 0) {
      // Extract only IDs (handle both string IDs and potential nested objects)
      const extractedIds = playlistData.assetIds.map((item: any) => {
        // If it's already a string ID, use it
        if (typeof item === "string") {
          return item;
        }
        // If it's an object with _id, extract the _id
        if (item && typeof item === "object" && item._id) {
          return item._id;
        }
        // Otherwise, try to convert to string
        return String(item);
      }).filter((id: string) => mongoose.Types.ObjectId.isValid(id));

      // Verify all assets exist and are direct assets (no campaignId)
      const existingAssets = await Asset.find({
        _id: { $in: extractedIds },
        campaignId: null, // Only allow direct assets
      }).select("_id");

      const existingAssetIds = new Set(existingAssets.map(a => a._id.toString()));
      const missingAssetIds = extractedIds.filter((id: string) => !existingAssetIds.has(id));

      if (missingAssetIds.length > 0) {
        return res.status(404).json({
          success: false,
          message: `Some direct assets not found: ${missingAssetIds.join(", ")}. Note: Only direct assets (not in campaigns) can be added.`,
        });
      }

      // Convert to ObjectIds - store ONLY IDs, no nested objects
      validatedAssetIds = extractedIds.map((id: string) => new mongoose.Types.ObjectId(id));
    }

    // Validate status if provided
    const validStatuses = ["active", "inactive", "scheduled"];
    if (playlistData.status && !validStatuses.includes(playlistData.status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Create playlist
    const playlist = new Playlist({
      name: playlistData.name.trim(),
      description: playlistData.description?.trim() || undefined,
      userId: playlistData.userId,
      status: playlistData.status || "inactive",
      campaignIds: validatedCampaignIds,
      assetIds: validatedAssetIds,
      schedule: playlistData.schedule,
    });

    await playlist.save();

    // Populate campaigns and assets for response
    await playlist.populate([
      {
      path: "campaignIds",
      select: "name description createdAt",
      },
      {
        path: "assetIds",
        select: "name type url thumbnail duration size",
      },
    ]);

    return res.status(201).json({
      success: true,
      message: "Playlist created successfully",
      data: {
        ...playlist.toObject(),
        campaignCount: validatedCampaignIds.length,
        directAssetCount: validatedAssetIds.length,
        maxCampaigns: MAX_CAMPAIGNS_PER_PLAYLIST,
        canAddMoreCampaigns: validatedCampaignIds.length < MAX_CAMPAIGNS_PER_PLAYLIST,
      },
    });
  } catch (error: any) {
    console.error("Error creating playlist:", error);

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
      message: "Failed to create playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// PUT /playlists/:id - Update Playlist
// ============================================================================

/**
 * PUT /api/playlists/:id
 * 
 * Updates an existing playlist (supports both campaigns and direct assets).
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    // Check if playlist exists
    const existingPlaylist = await Playlist.findById(id);
    if (!existingPlaylist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Build update object
    const updates: Record<string, any> = {};

    if (updateData.name !== undefined) {
      if (typeof updateData.name !== "string" || updateData.name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Playlist name cannot be empty",
        });
      }
      updates.name = updateData.name.trim();
    }

    if (updateData.description !== undefined) {
      updates.description = updateData.description?.trim() || "";
    }

    if (updateData.status !== undefined) {
      const validStatuses = ["active", "inactive", "scheduled"];
      if (!validStatuses.includes(updateData.status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }
      updates.status = updateData.status;
    }

    // Normalize and validate campaignIds - ensure only IDs are stored (no nested objects)
    if (updateData.campaignIds !== undefined) {
      if (!Array.isArray(updateData.campaignIds)) {
        return res.status(400).json({
          success: false,
          message: "campaignIds must be an array",
        });
      }

      // Extract only IDs (handle both string IDs and potential nested objects)
      const extractedIds = updateData.campaignIds.map((item: any) => {
        // If it's already a string ID, use it
        if (typeof item === "string") {
          return item;
        }
        // If it's an object with _id, extract the _id
        if (item && typeof item === "object" && item._id) {
          return item._id;
        }
        // Otherwise, try to convert to string
        return String(item);
      }).filter((id: string) => mongoose.Types.ObjectId.isValid(id));

      // Check max limit
      if (extractedIds.length > MAX_CAMPAIGNS_PER_PLAYLIST) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${MAX_CAMPAIGNS_PER_PLAYLIST} campaigns allowed in one playlist.`,
          provided: extractedIds.length,
          maxAllowed: MAX_CAMPAIGNS_PER_PLAYLIST,
        });
      }

      // Verify all campaigns exist
      if (extractedIds.length > 0) {
        const existingCampaigns = await Campaign.find({
          _id: { $in: extractedIds },
        }).select("_id");

        const existingIds = new Set(existingCampaigns.map(c => c._id.toString()));
        const missingIds = extractedIds.filter((id: string) => !existingIds.has(id));

        if (missingIds.length > 0) {
          return res.status(404).json({
            success: false,
            message: `Some campaigns not found: ${missingIds.join(", ")}`,
          });
        }
      }

      // Store ONLY IDs (convert to ObjectIds) - no nested objects
      updates.campaignIds = extractedIds.map((id: string) => new mongoose.Types.ObjectId(id));
    }

    // Normalize and validate assetIds - ensure only IDs are stored (no nested objects)
    if (updateData.assetIds !== undefined) {
      if (!Array.isArray(updateData.assetIds)) {
        return res.status(400).json({
          success: false,
          message: "assetIds must be an array",
        });
      }

      // Extract only IDs (handle both string IDs and potential nested objects)
      const extractedIds = updateData.assetIds.map((item: any) => {
        // If it's already a string ID, use it
        if (typeof item === "string") {
          return item;
        }
        // If it's an object with _id, extract the _id
        if (item && typeof item === "object" && item._id) {
          return item._id;
        }
        // Otherwise, try to convert to string
        return String(item);
      }).filter((id: string) => mongoose.Types.ObjectId.isValid(id));

      // Verify all assets exist and are direct assets (no campaignId)
      if (extractedIds.length > 0) {
        const existingAssets = await Asset.find({
          _id: { $in: extractedIds },
          campaignId: null, // Only allow direct assets
        }).select("_id");

        const existingAssetIds = new Set(existingAssets.map(a => a._id.toString()));
        const missingAssetIds = extractedIds.filter((id: string) => !existingAssetIds.has(id));

        if (missingAssetIds.length > 0) {
          return res.status(404).json({
            success: false,
            message: `Some direct assets not found: ${missingAssetIds.join(", ")}. Note: Only direct assets (not in campaigns) can be added.`,
          });
        }
      }

      // Store ONLY IDs (convert to ObjectIds) - no nested objects
      updates.assetIds = extractedIds.map((id: string) => new mongoose.Types.ObjectId(id));
    }

    if (updateData.schedule !== undefined) {
      updates.schedule = updateData.schedule;
    }

    const playlist = await Playlist.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate([
        {
        path: "campaignIds",
        select: "name description createdAt",
        },
        {
          path: "assetIds",
          select: "name type url thumbnail duration size",
        },
      ])
      .lean() as any;

    return res.status(200).json({
      success: true,
      message: "Playlist updated successfully",
      data: {
        ...playlist,
        campaignCount: (playlist!.campaignIds || []).length,
        directAssetCount: (playlist!.assetIds || []).length,
        maxCampaigns: MAX_CAMPAIGNS_PER_PLAYLIST,
        canAddMoreCampaigns: (playlist!.campaignIds || []).length < MAX_CAMPAIGNS_PER_PLAYLIST,
      },
    });
  } catch (error: any) {
    console.error("Error updating playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// PATCH /playlists/:id - Update Playlist (alias for PUT - frontend compatibility)
// ============================================================================

/**
 * PATCH /api/playlists/:id
 * 
 * Alias for PUT - frontend uses PATCH for updates.
 */
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    const existingPlaylist = await Playlist.findById(id);
    if (!existingPlaylist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    const updates: Record<string, any> = {};

    if (updateData.name !== undefined) {
      if (typeof updateData.name !== "string" || updateData.name.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: "Playlist name cannot be empty",
        });
      }
      updates.name = updateData.name.trim();
    }

    if (updateData.description !== undefined) {
      updates.description = updateData.description?.trim() || "";
    }

    if (updateData.status !== undefined) {
      const validStatuses = ["active", "inactive", "scheduled"];
      if (!validStatuses.includes(updateData.status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }
      updates.status = updateData.status;
    }

    // Normalize and validate campaignIds - ensure only IDs are stored (no nested objects)
    if (updateData.campaignIds !== undefined) {
      if (!Array.isArray(updateData.campaignIds)) {
        return res.status(400).json({
          success: false,
          message: "campaignIds must be an array",
        });
      }

      // Extract only IDs (handle both string IDs and potential nested objects)
      const extractedIds = updateData.campaignIds.map((item: any) => {
        // If it's already a string ID, use it
        if (typeof item === "string") {
          return item;
        }
        // If it's an object with _id, extract the _id
        if (item && typeof item === "object" && item._id) {
          return item._id;
        }
        // Otherwise, try to convert to string
        return String(item);
      }).filter((id: string) => mongoose.Types.ObjectId.isValid(id));

      if (extractedIds.length > MAX_CAMPAIGNS_PER_PLAYLIST) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${MAX_CAMPAIGNS_PER_PLAYLIST} campaigns allowed per playlist.`,
        });
      }

      if (extractedIds.length > 0) {
        const existingCampaigns = await Campaign.find({
          _id: { $in: extractedIds },
        }).select("_id");

        const existingIds = new Set(existingCampaigns.map(c => c._id.toString()));
        const missingIds = extractedIds.filter((id: string) => !existingIds.has(id));

        if (missingIds.length > 0) {
          return res.status(404).json({
            success: false,
            message: `Some campaigns not found: ${missingIds.join(", ")}`,
          });
        }
      }

      // Store ONLY IDs (convert to ObjectIds) - no nested objects
      updates.campaignIds = extractedIds.map((id: string) => new mongoose.Types.ObjectId(id));
    }

    // Normalize and validate assetIds - ensure only IDs are stored (no nested objects)
    if (updateData.assetIds !== undefined) {
      if (!Array.isArray(updateData.assetIds)) {
        return res.status(400).json({
          success: false,
          message: "assetIds must be an array",
        });
      }

      // Extract only IDs (handle both string IDs and potential nested objects)
      const extractedIds = updateData.assetIds.map((item: any) => {
        // If it's already a string ID, use it
        if (typeof item === "string") {
          return item;
        }
        // If it's an object with _id, extract the _id
        if (item && typeof item === "object" && item._id) {
          return item._id;
        }
        // Otherwise, try to convert to string
        return String(item);
      }).filter((id: string) => mongoose.Types.ObjectId.isValid(id));

      if (extractedIds.length > 0) {
        const existingAssets = await Asset.find({
          _id: { $in: extractedIds },
          campaignId: null,
        }).select("_id");

        const existingAssetIds = new Set(existingAssets.map(a => a._id.toString()));
        const missingAssetIds = extractedIds.filter((id: string) => !existingAssetIds.has(id));

        if (missingAssetIds.length > 0) {
          return res.status(404).json({
            success: false,
            message: `Some direct assets not found: ${missingAssetIds.join(", ")}`,
          });
        }
      }

      // Store ONLY IDs (convert to ObjectIds) - no nested objects
      updates.assetIds = extractedIds.map((id: string) => new mongoose.Types.ObjectId(id));
    }

    if (updateData.schedule !== undefined) {
      updates.schedule = updateData.schedule;
    }

    if (updateData.items !== undefined) {
      updates.items = updateData.items;
    }

    const playlist = await Playlist.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate([
        { path: "campaignIds", select: "name description createdAt" },
        { path: "assetIds", select: "name type url thumbnail duration size" },
        { path: "items.assetId" },
      ])
      .lean() as any;

    return res.status(200).json(playlist);
  } catch (error: any) {
    console.error("Error updating playlist (PATCH):", error);
    if (error.message && error.message.includes("Maximum")) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({
      success: false,
      message: "Failed to update playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// POST /playlists/add-assets - Add campaigns and/or direct assets to playlist
// ============================================================================

/**
 * POST /api/playlists/add-assets (or /api/playlist/add-assets)
 * 
 * Add both campaigns and direct assets to a playlist.
 * 
 * Body:
 *   - playlistId: The playlist ID (required)
 *   - campaignIds: Array of campaign IDs to add (optional)
 *   - assetIds: Array of direct asset IDs to add (optional)
 */
router.post("/add-assets", async (req: Request, res: Response) => {
  try {
    const { playlistId, campaignIds, assetIds } = req.body;

    if (!playlistId) {
      return res.status(400).json({
        success: false,
        message: "playlistId is required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(playlistId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    const playlist = await Playlist.findById(playlistId);
    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Handle campaigns
    if (campaignIds && Array.isArray(campaignIds) && campaignIds.length > 0) {
      // Validate all campaign IDs
      for (const cid of campaignIds) {
        if (!mongoose.Types.ObjectId.isValid(cid)) {
          return res.status(400).json({
            success: false,
            message: `Invalid campaign ID: ${cid}`,
          });
        }
      }

      // Check if adding would exceed limit
      const existingCampaignIds = playlist.campaignIds.map(c => c.toString());
      const newCampaignIds = campaignIds.filter((cid: string) => !existingCampaignIds.includes(cid));

      if (existingCampaignIds.length + newCampaignIds.length > MAX_CAMPAIGNS_PER_PLAYLIST) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${MAX_CAMPAIGNS_PER_PLAYLIST} campaigns allowed per playlist.`,
        });
      }

      // Verify campaigns exist
      const existingCampaigns = await Campaign.find({ _id: { $in: newCampaignIds } });
      if (existingCampaigns.length !== newCampaignIds.length) {
        return res.status(404).json({
          success: false,
          message: "Some campaigns not found",
        });
      }

      // Add new campaigns
      for (const cid of newCampaignIds) {
        playlist.campaignIds.push(new mongoose.Types.ObjectId(cid));
      }
    }

    // Handle direct assets
    if (assetIds && Array.isArray(assetIds) && assetIds.length > 0) {
      // Validate all asset IDs
      for (const aid of assetIds) {
        if (!mongoose.Types.ObjectId.isValid(aid)) {
          return res.status(400).json({
            success: false,
            message: `Invalid asset ID: ${aid}`,
          });
        }
      }

      // Only allow direct assets (campaignId = null)
      const existingAssets = await Asset.find({
        _id: { $in: assetIds },
        campaignId: null,
      });

      if (existingAssets.length !== assetIds.length) {
        return res.status(400).json({
          success: false,
          message: "Some assets not found or are not direct assets",
        });
      }

      const existingAssetIds = playlist.assetIds.map(a => a.toString());
      const newAssetIds = assetIds.filter((aid: string) => !existingAssetIds.includes(aid));

      for (const aid of newAssetIds) {
        playlist.assetIds.push(new mongoose.Types.ObjectId(aid));
      }
    }

    await playlist.save();

    await playlist.populate([
      { path: "campaignIds", select: "name description" },
      { path: "assetIds", select: "name type url thumbnail duration size" },
    ]);

    return res.status(200).json({
      success: true,
      message: "Assets added to playlist successfully",
      data: {
        ...playlist.toObject(),
        campaignCount: playlist.campaignIds.length,
        directAssetCount: playlist.assetIds.length,
        maxCampaigns: MAX_CAMPAIGNS_PER_PLAYLIST,
      },
    });
  } catch (error: any) {
    console.error("Error adding assets to playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add assets to playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// DELETE /playlists/:id - Delete Playlist
// ============================================================================

/**
 * DELETE /api/playlists/:id
 * 
 * Deletes a playlist by ID.
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    const playlist = await Playlist.findByIdAndDelete(id).lean();

    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Playlist deleted successfully",
      data: {
        id: (playlist as any)._id,
        name: (playlist as any).name,
      },
    });
  } catch (error: any) {
    console.error("Error deleting playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// POST /playlists/:id/campaigns - Add Campaign to Playlist
// ============================================================================

/**
 * POST /api/playlists/:id/campaigns
 * 
 * Adds a campaign to a playlist.
 */
router.post("/:id/campaigns", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { campaignId } = req.body;

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    if (!campaignId || !mongoose.Types.ObjectId.isValid(campaignId)) {
      return res.status(400).json({
        success: false,
        message: "Valid campaign ID is required",
      });
    }

    // Get playlist
    const playlist = await Playlist.findById(id);
    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Check if campaign exists
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    // Check max campaign limit
    if (playlist.campaignIds.length >= MAX_CAMPAIGNS_PER_PLAYLIST) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_CAMPAIGNS_PER_PLAYLIST} campaigns allowed in one playlist.`,
        currentCount: playlist.campaignIds.length,
        maxAllowed: MAX_CAMPAIGNS_PER_PLAYLIST,
      });
    }

    // Check if campaign already in playlist
    const campaignExists = playlist.campaignIds.some(
      (cid: mongoose.Types.ObjectId) => cid.toString() === campaignId
    );
    if (campaignExists) {
      return res.status(400).json({
        success: false,
        message: "Campaign already in this playlist",
      });
    }

    // Add campaign
    playlist.campaignIds.push(new mongoose.Types.ObjectId(campaignId));
    await playlist.save();

    await playlist.populate({
      path: "campaignIds",
      select: "name description createdAt",
    });

    return res.status(200).json({
      success: true,
      message: "Campaign added to playlist successfully",
      data: {
        ...playlist.toObject(),
        campaignCount: playlist.campaignIds.length,
        maxCampaigns: MAX_CAMPAIGNS_PER_PLAYLIST,
        canAddMoreCampaigns: playlist.campaignIds.length < MAX_CAMPAIGNS_PER_PLAYLIST,
      },
    });
  } catch (error: any) {
    console.error("Error adding campaign to playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add campaign to playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// DELETE /playlists/:id/campaigns/:campaignId - Remove Campaign from Playlist
// ============================================================================

/**
 * DELETE /api/playlists/:id/campaigns/:campaignId
 * 
 * Removes a campaign from a playlist.
 */
router.delete("/:id/campaigns/:campaignId", async (req: Request, res: Response) => {
  try {
    const { id, campaignId } = req.params;

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(campaignId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign ID format",
      });
    }

    // Get playlist
    const playlist = await Playlist.findById(id);
    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Check if campaign is in playlist
    const campaignIndex = playlist.campaignIds.findIndex(
      (cid: mongoose.Types.ObjectId) => cid.toString() === campaignId
    );

    if (campaignIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found in this playlist",
      });
    }

    // Remove campaign
    playlist.campaignIds.splice(campaignIndex, 1);
    await playlist.save();

    await playlist.populate({
      path: "campaignIds",
      select: "name description createdAt",
    });

    return res.status(200).json({
      success: true,
      message: "Campaign removed from playlist successfully",
      data: {
        ...playlist.toObject(),
        campaignCount: playlist.campaignIds.length,
        maxCampaigns: MAX_CAMPAIGNS_PER_PLAYLIST,
        canAddMoreCampaigns: playlist.campaignIds.length < MAX_CAMPAIGNS_PER_PLAYLIST,
      },
    });
  } catch (error: any) {
    console.error("Error removing campaign from playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove campaign from playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// POST /playlists/:id/assets - Add Direct Asset to Playlist
// ============================================================================

/**
 * POST /api/playlists/:id/assets
 * 
 * Adds a direct asset (not in any campaign) to a playlist.
 */
router.post("/:id/assets", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { assetId } = req.body;

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    if (!assetId || !mongoose.Types.ObjectId.isValid(assetId)) {
      return res.status(400).json({
        success: false,
        message: "Valid asset ID is required",
      });
    }

    // Get playlist
    const playlist = await Playlist.findById(id);
    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Check if asset exists and is a direct asset (no campaignId)
    const asset = await Asset.findOne({
      _id: assetId,
      campaignId: null,
    });
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Direct asset not found. Only assets not in campaigns can be added.",
      });
    }

    // Check if asset already in playlist
    const assetExists = playlist.assetIds.some(
      (aid: mongoose.Types.ObjectId) => aid.toString() === assetId
    );
    if (assetExists) {
      return res.status(400).json({
        success: false,
        message: "Asset already in this playlist",
      });
    }

    // Add asset
    playlist.assetIds.push(new mongoose.Types.ObjectId(assetId));
    await playlist.save();

    await playlist.populate([
      {
        path: "campaignIds",
        select: "name description createdAt",
      },
      {
        path: "assetIds",
        select: "name type url thumbnail duration size",
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "Direct asset added to playlist successfully",
      data: {
        ...playlist.toObject(),
        campaignCount: playlist.campaignIds.length,
        directAssetCount: playlist.assetIds.length,
        maxCampaigns: MAX_CAMPAIGNS_PER_PLAYLIST,
        canAddMoreCampaigns: playlist.campaignIds.length < MAX_CAMPAIGNS_PER_PLAYLIST,
      },
    });
  } catch (error: any) {
    console.error("Error adding asset to playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add asset to playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// DELETE /playlists/:id/assets/:assetId - Remove Direct Asset from Playlist
// ============================================================================

/**
 * DELETE /api/playlists/:id/assets/:assetId
 * 
 * Removes a direct asset from a playlist.
 */
router.delete("/:id/assets/:assetId", async (req: Request, res: Response) => {
  try {
    const { id, assetId } = req.params;

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(assetId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid asset ID format",
      });
    }

    // Get playlist
    const playlist = await Playlist.findById(id);
    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Check if asset is in playlist
    const assetIndex = playlist.assetIds.findIndex(
      (aid: mongoose.Types.ObjectId) => aid.toString() === assetId
    );

    if (assetIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Asset not found in this playlist",
      });
    }

    // Remove asset
    playlist.assetIds.splice(assetIndex, 1);
    await playlist.save();

    await playlist.populate([
      {
        path: "campaignIds",
        select: "name description createdAt",
      },
      {
        path: "assetIds",
        select: "name type url thumbnail duration size",
      },
    ]);

    return res.status(200).json({
      success: true,
      message: "Direct asset removed from playlist successfully",
      data: {
        ...playlist.toObject(),
        campaignCount: playlist.campaignIds.length,
        directAssetCount: playlist.assetIds.length,
        maxCampaigns: MAX_CAMPAIGNS_PER_PLAYLIST,
        canAddMoreCampaigns: playlist.campaignIds.length < MAX_CAMPAIGNS_PER_PLAYLIST,
      },
    });
  } catch (error: any) {
    console.error("Error removing asset from playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to remove asset from playlist",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Export the router
export const playlistRoutes = router;
