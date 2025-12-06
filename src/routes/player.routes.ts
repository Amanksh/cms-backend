import { Router, Request, Response } from "express";
import Playlist from "../models/Playlist";
import Campaign from "../models/Campaign";
import Asset from "../models/Asset";
import Display from "../models/Display";
import mongoose from "mongoose";

/**
 * Player Routes
 * 
 * API endpoints specifically designed for Android/Digital Signage Players.
 * These endpoints return fully expanded playlists with all campaign assets
 * in the correct playback order.
 */

const router = Router();

// ============================================================================
// Types & Interfaces
// ============================================================================

interface ExpandedAsset {
  assetId: string;
  name: string;
  campaignId: string;
  campaignName: string;
  type: "IMAGE" | "VIDEO" | "HTML" | "URL";
  url: string;
  localPath?: string;
  thumbnail?: string;
  duration: number;
  size: number;
  order: number;
}

interface PlayerPlaylistResponse {
  playlistId: string;
  playlistName: string;
  status: string;
  totalAssets: number;
  totalDuration: number;
  assets: ExpandedAsset[];
  campaigns: {
    id: string;
    name: string;
    assetCount: number;
  }[];
  schedule?: {
    startDate: Date;
    endDate: Date;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  };
  updatedAt: Date;
}

// ============================================================================
// GET /player/playlist - Get Playlist for Player
// ============================================================================

/**
 * GET /api/player/playlist
 * 
 * Returns a fully expanded playlist with all assets from all campaigns
 * in the correct playback order.
 * 
 * Query Parameters:
 *   - playlistId: The playlist ID to fetch
 *   - deviceId: Optional device ID for device-specific playlist
 * 
 * Response includes:
 *   - Expanded list of all assets inside selected campaigns
 *   - Assets in correct playback order (by campaign order, then asset order)
 *   - campaignName, assetId, type, url/localPath, duration for each asset
 */
router.get("/playlist", async (req: Request, res: Response) => {
  try {
    const { playlistId, deviceId } = req.query as { playlistId?: string; deviceId?: string };

    let targetPlaylistId = playlistId;

    // If deviceId provided, get playlist from display
    if (deviceId && !playlistId) {
      const display = await Display.findOne({ deviceId }).lean() as any;
      if (display && display.playlistId) {
        targetPlaylistId = display.playlistId.toString();
      }
    }

    if (!targetPlaylistId) {
      return res.status(400).json({
        success: false,
        message: "Playlist ID or Device ID is required",
      });
    }

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(targetPlaylistId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    // Get playlist with campaigns
    const playlist = await Playlist.findById(targetPlaylistId)
      .populate({
        path: "campaignIds",
        select: "name description",
      })
      .lean() as any;

    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Check if playlist is active or scheduled
    if (playlist.status === "inactive") {
      return res.status(200).json({
        success: true,
        message: "Playlist is inactive",
        data: {
          playlistId: playlist._id,
          playlistName: playlist.name,
          status: playlist.status,
          totalAssets: 0,
          totalDuration: 0,
          assets: [],
          campaigns: [],
        },
      });
    }

    // Get campaign IDs in order
    const campaignIds = (playlist.campaignIds || []).map((c: any) => c._id);
    const campaignsMap = new Map(
      (playlist.campaignIds || []).map((c: any) => [c._id.toString(), c])
    );

    // Get all assets for all campaigns
    const assets = await Asset.find({
      campaignId: { $in: campaignIds },
    })
      .sort({ createdAt: 1 })
      .lean() as any[];

    // Group assets by campaign
    const assetsByCampaign = new Map<string, any[]>();
    assets.forEach(asset => {
      const campaignIdStr = asset.campaignId.toString();
      if (!assetsByCampaign.has(campaignIdStr)) {
        assetsByCampaign.set(campaignIdStr, []);
      }
      assetsByCampaign.get(campaignIdStr)!.push(asset);
    });

    // Build expanded assets list in playback order
    const expandedAssets: ExpandedAsset[] = [];
    let globalOrder = 0;
    let totalDuration = 0;

    // Process campaigns in their playlist order
    for (const campaignId of campaignIds) {
      const campaignIdStr = campaignId.toString();
      const campaign = campaignsMap.get(campaignIdStr);
      const campaignAssets = assetsByCampaign.get(campaignIdStr) || [];

      for (const asset of campaignAssets) {
        const assetDuration = asset.duration || 10; // Default 10 seconds for images
        totalDuration += assetDuration;

        expandedAssets.push({
          assetId: asset._id.toString(),
          name: asset.name,
          campaignId: campaignIdStr,
          campaignName: (campaign as any)?.name || "Unknown Campaign",
          type: asset.type,
          url: asset.url,
          localPath: asset.url, // Can be updated to local cache path by player
          thumbnail: asset.thumbnail,
          duration: assetDuration,
          size: asset.size,
          order: globalOrder++,
        });
      }
    }

    // Build campaign summary
    const campaignSummary = campaignIds.map((campaignId: any) => {
      const campaignIdStr = campaignId.toString();
      const campaign = campaignsMap.get(campaignIdStr);
      return {
        id: campaignIdStr,
        name: (campaign as any)?.name || "Unknown Campaign",
        assetCount: (assetsByCampaign.get(campaignIdStr) || []).length,
      };
    });

    const response: PlayerPlaylistResponse = {
      playlistId: playlist._id.toString(),
      playlistName: playlist.name,
      status: playlist.status,
      totalAssets: expandedAssets.length,
      totalDuration,
      assets: expandedAssets,
      campaigns: campaignSummary,
      schedule: playlist.schedule,
      updatedAt: playlist.updatedAt,
    };

    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("Error fetching player playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch playlist for player",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /player/playlist/:id - Get Specific Playlist for Player
// ============================================================================

/**
 * GET /api/player/playlist/:id
 * 
 * Alternative endpoint to get a specific playlist by ID.
 */
router.get("/playlist/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid playlist ID format",
      });
    }

    // Get playlist with campaigns
    const playlist = await Playlist.findById(id)
      .populate({
        path: "campaignIds",
        select: "name description",
      })
      .lean() as any;

    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Get campaign IDs in order
    const campaignIds = (playlist.campaignIds || []).map((c: any) => c._id);
    const campaignsMap = new Map(
      (playlist.campaignIds || []).map((c: any) => [c._id.toString(), c])
    );

    // Get all assets for all campaigns
    const assets = await Asset.find({
      campaignId: { $in: campaignIds },
    })
      .sort({ createdAt: 1 })
      .lean() as any[];

    // Group assets by campaign
    const assetsByCampaign = new Map<string, any[]>();
    assets.forEach(asset => {
      const campaignIdStr = asset.campaignId.toString();
      if (!assetsByCampaign.has(campaignIdStr)) {
        assetsByCampaign.set(campaignIdStr, []);
      }
      assetsByCampaign.get(campaignIdStr)!.push(asset);
    });

    // Build expanded assets list in playback order
    const expandedAssets: ExpandedAsset[] = [];
    let globalOrder = 0;
    let totalDuration = 0;

    for (const campaignId of campaignIds) {
      const campaignIdStr = campaignId.toString();
      const campaign = campaignsMap.get(campaignIdStr);
      const campaignAssets = assetsByCampaign.get(campaignIdStr) || [];

      for (const asset of campaignAssets) {
        const assetDuration = asset.duration || 10;
        totalDuration += assetDuration;

        expandedAssets.push({
          assetId: asset._id.toString(),
          name: asset.name,
          campaignId: campaignIdStr,
          campaignName: (campaign as any)?.name || "Unknown Campaign",
          type: asset.type,
          url: asset.url,
          localPath: asset.url,
          thumbnail: asset.thumbnail,
          duration: assetDuration,
          size: asset.size,
          order: globalOrder++,
        });
      }
    }

    // Build campaign summary
    const campaignSummary = campaignIds.map((campaignId: any) => {
      const campaignIdStr = campaignId.toString();
      const campaign = campaignsMap.get(campaignIdStr);
      return {
        id: campaignIdStr,
        name: (campaign as any)?.name || "Unknown Campaign",
        assetCount: (assetsByCampaign.get(campaignIdStr) || []).length,
      };
    });

    const response: PlayerPlaylistResponse = {
      playlistId: playlist._id.toString(),
      playlistName: playlist.name,
      status: playlist.status,
      totalAssets: expandedAssets.length,
      totalDuration,
      assets: expandedAssets,
      campaigns: campaignSummary,
      schedule: playlist.schedule,
      updatedAt: playlist.updatedAt,
    };

    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error: any) {
    console.error("Error fetching player playlist:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch playlist for player",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /player/campaigns - List All Campaigns with Assets
// ============================================================================

/**
 * GET /api/player/campaigns
 * 
 * Returns all campaigns with their assets for player caching.
 */
router.get("/campaigns", async (req: Request, res: Response) => {
  try {
    const campaigns = await Campaign.find().sort({ name: 1 }).lean() as any[];

    // Get all assets
    const assets = await Asset.find().sort({ campaignId: 1, createdAt: 1 }).lean() as any[];

    // Group assets by campaign
    const assetsByCampaign = new Map<string, any[]>();
    for (const asset of assets) {
      const campaignIdStr = asset.campaignId.toString();
      if (!assetsByCampaign.has(campaignIdStr)) {
        assetsByCampaign.set(campaignIdStr, []);
      }
      assetsByCampaign.get(campaignIdStr)!.push({
        assetId: asset._id.toString(),
        name: asset.name,
        type: asset.type,
        url: asset.url,
        thumbnail: asset.thumbnail,
        duration: asset.duration || 10,
        size: asset.size,
      });
    }

    const campaignsWithAssets = campaigns.map(campaign => ({
      campaignId: campaign._id.toString(),
      name: campaign.name,
      description: campaign.description,
      assets: assetsByCampaign.get(campaign._id.toString()) || [],
      assetCount: (assetsByCampaign.get(campaign._id.toString()) || []).length,
      updatedAt: campaign.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      data: campaignsWithAssets,
      totalCampaigns: campaigns.length,
      totalAssets: assets.length,
    });
  } catch (error: any) {
    console.error("Error fetching campaigns for player:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch campaigns for player",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================================================
// GET /player/asset/:id - Get Single Asset Details for Player
// ============================================================================

/**
 * GET /api/player/asset/:id
 * 
 * Returns detailed asset information including campaign context.
 */
router.get("/asset/:id", async (req: Request, res: Response) => {
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
      .lean() as any;

    if (!asset) {
      return res.status(404).json({
        success: false,
        message: "Asset not found",
      });
    }

    const campaignId = asset.campaignId?._id?.toString() || asset.campaignId?.toString() || "";
    const campaignName = asset.campaignId?.name || "Unknown Campaign";

    return res.status(200).json({
      success: true,
      data: {
        assetId: asset._id.toString(),
        name: asset.name,
        campaignId,
        campaignName,
        type: asset.type,
        url: asset.url,
        localPath: asset.url,
        thumbnail: asset.thumbnail,
        duration: asset.duration || 10,
        size: asset.size,
      },
    });
  } catch (error: any) {
    console.error("Error fetching asset for player:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch asset for player",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Export the router
export const playerRoutes = router;
