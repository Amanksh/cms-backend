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
 * These endpoints return FLATTENED playlists with all assets (from campaigns
 * and direct assets) in the correct playback order.
 * 
 * Response Format for Player:
 * {
 *   "playlistId": "...",
 *   "assets": [
 *     {
 *       "assetId": "...",
 *       "type": "VIDEO",
 *       "url": "...",
 *       "duration": 10
 *     }
 *   ]
 * }
 * 
 * NOTE: Assets are FLATTENED - no nested campaign structures.
 * All assets (from campaigns and direct assets) are in one unified array.
 * 
 * Supports:
 * - Campaigns (folders) containing multiple assets (max 8-9 per campaign)
 * - Direct assets (standalone assets not in any campaign)
 * - Playlists with 6-7 campaigns
 * - Mixed content playlists (campaigns + direct assets)
 */

const router = Router();

// ============================================================================
// Types & Interfaces
// ============================================================================

interface FlattenedAsset {
  assetId: string;
  type: "IMAGE" | "VIDEO" | "HTML" | "URL";
  url: string;
  duration: number;
}

interface PlayerPlaylistResponse {
  playlistId: string;
  playlistName?: string;
  status?: string;
  totalAssets: number;
  assets: FlattenedAsset[];
}

// ============================================================================
// GET /player/playlist - Get Playlist for Player (Flattened)
// ============================================================================

/**
 * GET /api/player/playlist
 * 
 * Returns a FLATTENED playlist with all assets from:
 * 1. All campaigns (expanded to individual assets)
 * 2. All direct assets
 * 
 * Query Parameters:
 *   - playlistId: The playlist ID to fetch
 *   - deviceId: Optional device ID for device-specific playlist
 * 
 * Response: Flattened array of assets with:
 *   - assetId, type, url, duration
 * 
 * NOTE: Does NOT return campaignIds or nested structures - returns FLATTENED assets array only
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

    // Get playlist
    const playlist = await Playlist.findById(targetPlaylistId).lean() as any;

    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Check if playlist is active or scheduled
    if (playlist.status === "inactive") {
      return res.status(200).json({
        playlistId: playlist._id.toString(),
        playlistName: playlist.name,
        status: playlist.status,
        totalAssets: 0,
        assets: [],
      });
    }

    // Build flattened assets array
    const flattenedAssets: FlattenedAsset[] = [];

    // 1. Expand campaigns to get their assets (in order)
    if (playlist.campaignIds && playlist.campaignIds.length > 0) {
      for (const campaignId of playlist.campaignIds) {
        // Get campaign assets
        const campaignAssets = await Asset.find({ campaignId })
          .select("_id name type url thumbnail duration")
          .sort({ createdAt: 1 })
          .lean() as any[];

        // Add each asset (flattened, no campaign reference)
        for (const asset of campaignAssets) {
          flattenedAssets.push({
            assetId: asset._id.toString(),
            type: asset.type,
            url: asset.url,
            duration: asset.duration || (asset.type === "VIDEO" ? 0 : 10),
          });
        }
      }
    }

    // 2. Add direct assets (standalone assets not in any campaign)
    if (playlist.assetIds && playlist.assetIds.length > 0) {
      const directAssets = await Asset.find({
        _id: { $in: playlist.assetIds },
      })
        .select("_id name type url thumbnail duration")
        .sort({ createdAt: 1 })
        .lean() as any[];

      for (const asset of directAssets) {
        flattenedAssets.push({
          assetId: asset._id.toString(),
          type: asset.type,
          url: asset.url,
          duration: asset.duration || (asset.type === "VIDEO" ? 0 : 10),
        });
      }
    }

    // 3. Legacy support: If no campaigns/direct assets but has items, use items
    if (
      flattenedAssets.length === 0 &&
      playlist.items &&
      playlist.items.length > 0
    ) {
      for (const item of playlist.items) {
        if (item.assetId) {
          const asset = await Asset.findById(item.assetId).lean() as any;
          if (asset) {
            flattenedAssets.push({
              assetId: asset._id.toString(),
              type: asset.type,
              url: asset.url,
              duration: item.duration || asset.duration || 10,
            });
          }
        }
      }
    }

    // Return the exact format for Android player
    // DO NOT return campaignIds - return FLATTENED assets
    const response: PlayerPlaylistResponse = {
      playlistId: playlist._id.toString(),
      playlistName: playlist.name,
      status: playlist.status,
      totalAssets: flattenedAssets.length,
      assets: flattenedAssets,
    };

    return res.status(200).json(response);
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
// GET /player/playlist/:id - Get Specific Playlist for Player (Flattened)
// ============================================================================

/**
 * GET /api/player/playlist/:id
 * 
 * Alternative endpoint to get a specific playlist by ID.
 * Returns FLATTENED assets array - same format as /player/playlist
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

    // Get playlist
    const playlist = await Playlist.findById(id).lean() as any;

    if (!playlist) {
      return res.status(404).json({
        success: false,
        message: "Playlist not found",
      });
    }

    // Build flattened assets array
    const flattenedAssets: FlattenedAsset[] = [];

    // 1. Expand campaigns to get their assets (in order)
    if (playlist.campaignIds && playlist.campaignIds.length > 0) {
      for (const campaignId of playlist.campaignIds) {
        const campaignAssets = await Asset.find({ campaignId })
          .select("_id name type url thumbnail duration")
          .sort({ createdAt: 1 })
          .lean() as any[];

        for (const asset of campaignAssets) {
          flattenedAssets.push({
            assetId: asset._id.toString(),
            type: asset.type,
            url: asset.url,
            duration: asset.duration || (asset.type === "VIDEO" ? 0 : 10),
          });
        }
      }
    }

    // 2. Add direct assets
    if (playlist.assetIds && playlist.assetIds.length > 0) {
      const directAssets = await Asset.find({
        _id: { $in: playlist.assetIds },
      })
        .select("_id name type url thumbnail duration")
        .sort({ createdAt: 1 })
        .lean() as any[];

      for (const asset of directAssets) {
        flattenedAssets.push({
          assetId: asset._id.toString(),
          type: asset.type,
          url: asset.url,
          duration: asset.duration || (asset.type === "VIDEO" ? 0 : 10),
        });
      }
    }

    // 3. Legacy support
    if (
      flattenedAssets.length === 0 &&
      playlist.items &&
      playlist.items.length > 0
    ) {
      for (const item of playlist.items) {
        if (item.assetId) {
          const asset = await Asset.findById(item.assetId).lean() as any;
          if (asset) {
            flattenedAssets.push({
              assetId: asset._id.toString(),
              type: asset.type,
              url: asset.url,
              duration: item.duration || asset.duration || 10,
            });
          }
        }
      }
    }

    const response: PlayerPlaylistResponse = {
      playlistId: playlist._id.toString(),
      playlistName: playlist.name,
      status: playlist.status,
      totalAssets: flattenedAssets.length,
      assets: flattenedAssets,
    };

    return res.status(200).json(response);
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

    // Get all assets grouped by campaign
    const assets = await Asset.find({ campaignId: { $ne: null } })
      .sort({ campaignId: 1, createdAt: 1 })
      .lean() as any[];

    // Group assets by campaign
    const assetsByCampaign = new Map<string, any[]>();
    for (const asset of assets) {
      if (asset.campaignId) {
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
// GET /player/direct-assets - List All Direct Assets (Not in Campaigns)
// ============================================================================

/**
 * GET /api/player/direct-assets
 * 
 * Returns all direct/standalone assets (not in any campaign) for player caching.
 */
router.get("/direct-assets", async (req: Request, res: Response) => {
  try {
    const directAssets = await Asset.find({ campaignId: null })
      .sort({ createdAt: -1 })
      .lean() as any[];

    const formattedAssets = directAssets.map(asset => ({
      assetId: asset._id.toString(),
      name: asset.name,
      type: asset.type,
      url: asset.url,
      thumbnail: asset.thumbnail,
      duration: asset.duration || (asset.type === "VIDEO" ? 0 : 10),
      size: asset.size,
      createdAt: asset.createdAt,
    }));

    return res.status(200).json({
      success: true,
      data: formattedAssets,
      totalAssets: directAssets.length,
    });
  } catch (error: any) {
    console.error("Error fetching direct assets for player:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch direct assets for player",
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
 * Returns detailed asset information including campaign context (if any).
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

    // Handle both campaign assets and direct assets
    let campaignId: string | null = null;
    let campaignName: string | null = null;

    if (asset.campaignId) {
      campaignId = asset.campaignId._id?.toString() || asset.campaignId.toString();
      campaignName = asset.campaignId.name || null;
    }

    return res.status(200).json({
      success: true,
      data: {
        assetId: asset._id.toString(),
        name: asset.name,
        campaignId: campaignId,
        campaignName: campaignName,
        type: asset.type,
        url: asset.url,
        thumbnail: asset.thumbnail,
        duration: asset.duration || (asset.type === "VIDEO" ? 0 : 10),
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
