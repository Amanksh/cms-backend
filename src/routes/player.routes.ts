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
 *   "items": [
 *     {
 *       "assetId": "...",
 *       "type": "video",
 *       "url": "...",
 *       "duration": 10
 *     }
 *   ]
 * }
 * 
 * NOTE: 
 * - Assets are FLATTENED - no nested campaign structures
 * - All assets (from campaigns and direct assets) are in one unified array
 * - Type is lowercase: "image" or "video" (not "IMAGE" or "VIDEO")
 * - Every asset MUST have: assetId, type, url, duration
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
  type: "image" | "video";
  url: string;
  duration: number;
}

interface PlayerPlaylistResponse {
  playlistId: string;
  items: FlattenedAsset[];
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
 * Response Format:
 * {
 *   "playlistId": "...",
 *   "items": [
 *     { "assetId": "...", "type": "image", "url": "...", "duration": 10 },
 *     { "assetId": "...", "type": "video", "url": "...", "duration": 30 }
 *   ]
 * }
 * 
 * NOTE: 
 * - Does NOT return campaignIds or nested structures
 * - Type is lowercase: "image" or "video"
 * - All assets validated to have required fields
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

    console.log(`[PLAYER_PLAYLIST] Step 1: Fetching playlist: ${targetPlaylistId}`);

    // Step 1: Get playlist
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
        items: [],
      });
    }

    console.log(`[PLAYER_PLAYLIST] Playlist found: ${playlist.name}`);
    console.log(`[PLAYER_PLAYLIST] Campaign IDs: ${playlist.campaignIds?.length || 0}, Direct asset IDs: ${playlist.assetIds?.length || 0}`);

    // Helper function to convert type to lowercase and validate asset
    const formatAsset = (asset: any, durationOverride?: number): FlattenedAsset | null => {
      // Validate required fields
      if (!asset._id || !asset.type || !asset.url) {
        console.warn(`Skipping asset with missing required fields: ${asset._id}`);
        return null;
      }

      // Convert type to lowercase
      const typeLower = asset.type.toLowerCase();
      
      // Android Player only supports "image" or "video" - filter out others
      if (typeLower !== "image" && typeLower !== "video") {
        console.warn(`Skipping asset with unsupported type: ${asset.type} (only image/video supported)`);
        return null;
      }

      // Calculate duration
      const duration = durationOverride ?? asset.duration ?? (asset.type === "VIDEO" ? 0 : 10);

      // Ensure URL is valid (should be full CDN URL)
      if (!asset.url || asset.url.trim() === "") {
        console.warn(`Skipping asset with empty URL: ${asset._id}`);
        return null;
      }

      // Ensure URL is absolute (starts with http:// or https://)
      let absoluteUrl = asset.url.trim();
      if (!absoluteUrl.startsWith("http://") && !absoluteUrl.startsWith("https://")) {
        // If relative URL, log warning but don't skip (might be handled by player)
        console.warn(`Asset URL is not absolute: ${absoluteUrl} (assetId: ${asset._id})`);
        // Optionally, you could prepend a base URL here if you have one configured
        // absoluteUrl = `${process.env.CDN_BASE_URL || ''}${absoluteUrl}`;
      }

      return {
        assetId: asset._id.toString(),
        type: typeLower as "image" | "video",
        url: absoluteUrl,
        duration: Math.max(0, duration), // Ensure non-negative duration
      };
    };

    // Build flattened assets array with debug logging
    const flattenedAssets: FlattenedAsset[] = [];
    const seenAssetIds = new Set<string>();
    
    console.log(`[PLAYER_PLAYLIST] Expanding playlist: ${playlist._id}`);
    console.log(`[PLAYER_PLAYLIST] Campaigns: ${playlist.campaignIds?.length || 0}, Direct assets: ${playlist.assetIds?.length || 0}`);

    // 1. Expand campaigns to get their assets (in order)
    if (playlist.campaignIds && playlist.campaignIds.length > 0) {
      console.log(`[PLAYER_PLAYLIST] Processing ${playlist.campaignIds.length} campaigns...`);
      
      for (let i = 0; i < playlist.campaignIds.length; i++) {
        const campaignId = playlist.campaignIds[i];
        const campaignIdStr = campaignId.toString ? campaignId.toString() : campaignId._id?.toString() || campaignId;
        
        console.log(`[PLAYER_PLAYLIST] Campaign ${i + 1}/${playlist.campaignIds.length}: ${campaignIdStr}`);
        
        try {
          // Step 2: Fetch campaign
          const campaign = await Campaign.findById(campaignIdStr).lean() as any;
          
          if (!campaign) {
            console.warn(`[PLAYER_PLAYLIST] Campaign ${campaignIdStr} not found, skipping`);
            continue;
          }

          console.log(`[PLAYER_PLAYLIST] Campaign found: ${campaign.name || 'Unnamed'}`);

          // Step 3: Load all assets inside that campaign
          const campaignObjectId = new mongoose.Types.ObjectId(campaignIdStr);
          const campaignAssets = await Asset.find({ campaignId: campaignObjectId })
            .select("_id name type url thumbnail duration")
            .sort({ createdAt: 1 })
            .lean() as any[];

          console.log(`[PLAYER_PLAYLIST] Step 3: Found ${campaignAssets.length} assets in campaign ${campaign.name}`);

          // Add each asset (flattened, no campaign reference, avoiding duplicates)
          for (const asset of campaignAssets) {
            const assetIdStr = asset._id.toString();
            
            if (!seenAssetIds.has(assetIdStr)) {
              seenAssetIds.add(assetIdStr);
              const formattedAsset = formatAsset(asset);
              if (formattedAsset) {
                flattenedAssets.push(formattedAsset);
                console.log(`[PLAYER_PLAYLIST] Added asset: ${asset.name || assetIdStr} (${asset.type})`);
              }
            } else {
              console.log(`[PLAYER_PLAYLIST] Skipped duplicate asset: ${asset.name || assetIdStr}`);
            }
          }
        } catch (error: any) {
          console.error(`[PLAYER_PLAYLIST] Error fetching campaign ${campaignIdStr}:`, error);
        }
      }
    }

    // 2. Add direct assets (standalone assets not in any campaign)
    if (playlist.assetIds && playlist.assetIds.length > 0) {
      console.log(`[PLAYER_PLAYLIST] Processing ${playlist.assetIds.length} direct assets...`);
      
      const directAssets = await Asset.find({
        _id: { $in: playlist.assetIds },
      })
        .select("_id name type url thumbnail duration")
        .sort({ createdAt: 1 })
        .lean() as any[];

      console.log(`[PLAYER_PLAYLIST] Found ${directAssets.length} direct assets in database`);

      for (const asset of directAssets) {
        const assetIdStr = asset._id.toString();
        
        if (!seenAssetIds.has(assetIdStr)) {
          seenAssetIds.add(assetIdStr);
          const formattedAsset = formatAsset(asset);
          if (formattedAsset) {
            flattenedAssets.push(formattedAsset);
            console.log(`[PLAYER_PLAYLIST] Added direct asset: ${asset.name || assetIdStr} (${asset.type})`);
          }
        } else {
          console.log(`[PLAYER_PLAYLIST] Skipped duplicate direct asset: ${asset.name || assetIdStr}`);
        }
      }
    }

    // 3. Legacy support: If no campaigns/direct assets but has items, use items
    if (
      flattenedAssets.length === 0 &&
      playlist.items &&
      playlist.items.length > 0
    ) {
      console.log(`[PLAYER_PLAYLIST] No campaign/direct assets, using legacy items (${playlist.items.length} items)`);
      
      for (const item of playlist.items) {
        if (item.assetId) {
          try {
            const asset = await Asset.findById(item.assetId).lean() as any;
            if (asset) {
              const assetIdStr = asset._id.toString();
              if (!seenAssetIds.has(assetIdStr)) {
                seenAssetIds.add(assetIdStr);
                const formattedAsset = formatAsset(asset, item.duration);
                if (formattedAsset) {
                  flattenedAssets.push(formattedAsset);
                  console.log(`[PLAYER_PLAYLIST] Added legacy item asset: ${asset.name || assetIdStr}`);
                }
              }
            }
          } catch (error: any) {
            console.error(`[PLAYER_PLAYLIST] Error fetching legacy asset ${item.assetId}:`, error);
          }
        }
      }
    }

    console.log(`[PLAYER_PLAYLIST] Resolved campaign assets:`, flattenedAssets);
    console.log(`[PLAYER_PLAYLIST] Final asset count: ${flattenedAssets.length}`);

    // Return the exact format for Android player
    // Only playlistId and items array - no nested structures
    const response: PlayerPlaylistResponse = {
      playlistId: playlist._id.toString(),
      items: flattenedAssets,
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

    console.log(`[PLAYER_PLAYLIST_ID] Step 1: Fetching playlist: ${id}`);

    // Step 1: Get playlist
    const playlist = await Playlist.findById(id).lean() as any;

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
        items: [],
      });
    }

    console.log(`[PLAYER_PLAYLIST_ID] Playlist found: ${playlist.name}`);
    console.log(`[PLAYER_PLAYLIST_ID] Campaign IDs: ${playlist.campaignIds?.length || 0}, Direct asset IDs: ${playlist.assetIds?.length || 0}`);

    // Helper function to convert type to lowercase and validate asset
    const formatAsset = (asset: any, durationOverride?: number): FlattenedAsset | null => {
      // Validate required fields
      if (!asset._id || !asset.type || !asset.url) {
        console.warn(`Skipping asset with missing required fields: ${asset._id}`);
        return null;
      }

      // Convert type to lowercase
      const typeLower = asset.type.toLowerCase();
      
      // Android Player only supports "image" or "video" - filter out others
      if (typeLower !== "image" && typeLower !== "video") {
        console.warn(`Skipping asset with unsupported type: ${asset.type} (only image/video supported)`);
        return null;
      }

      // Calculate duration
      const duration = durationOverride ?? asset.duration ?? (asset.type === "VIDEO" ? 0 : 10);

      // Ensure URL is valid (should be full CDN URL)
      if (!asset.url || asset.url.trim() === "") {
        console.warn(`Skipping asset with empty URL: ${asset._id}`);
        return null;
      }

      // Ensure URL is absolute (starts with http:// or https://)
      let absoluteUrl = asset.url.trim();
      if (!absoluteUrl.startsWith("http://") && !absoluteUrl.startsWith("https://")) {
        // If relative URL, log warning but don't skip (might be handled by player)
        console.warn(`Asset URL is not absolute: ${absoluteUrl} (assetId: ${asset._id})`);
        // Optionally, you could prepend a base URL here if you have one configured
        // absoluteUrl = `${process.env.CDN_BASE_URL || ''}${absoluteUrl}`;
      }

      return {
        assetId: asset._id.toString(),
        type: typeLower as "image" | "video",
        url: absoluteUrl,
        duration: Math.max(0, duration), // Ensure non-negative duration
      };
    };

    // Step 2 & 3: For each campaignId, fetch campaign and its assets
    const flattenedAssets: FlattenedAsset[] = [];
    const seenAssetIds = new Set<string>();

    if (playlist.campaignIds && Array.isArray(playlist.campaignIds) && playlist.campaignIds.length > 0) {
      console.log(`[PLAYER_PLAYLIST_ID] Step 2: Processing ${playlist.campaignIds.length} campaigns...`);

      for (let i = 0; i < playlist.campaignIds.length; i++) {
        const campaignId = playlist.campaignIds[i];
        
        // Handle campaignId (could be ObjectId, populated object, or string)
        let campaignIdStr: string;
        if (campaignId && typeof campaignId === 'object' && campaignId._id) {
          campaignIdStr = campaignId._id.toString();
        } else if (campaignId && typeof campaignId.toString === 'function') {
          campaignIdStr = campaignId.toString();
        } else if (typeof campaignId === 'string') {
          campaignIdStr = campaignId;
        } else {
          console.warn(`[PLAYER_PLAYLIST_ID] Invalid campaign ID at index ${i}, skipping`);
          continue;
        }

        if (!mongoose.Types.ObjectId.isValid(campaignIdStr)) {
          console.warn(`[PLAYER_PLAYLIST_ID] Invalid ObjectId format: ${campaignIdStr}, skipping`);
          continue;
        }

        console.log(`[PLAYER_PLAYLIST_ID] Step 2.${i + 1}: Fetching campaign: ${campaignIdStr}`);

        try {
          // Step 2: Fetch campaign
          const campaign = await Campaign.findById(campaignIdStr).lean() as any;
          
          if (!campaign) {
            console.warn(`[PLAYER_PLAYLIST_ID] Campaign ${campaignIdStr} not found, skipping`);
            continue;
          }

          console.log(`[PLAYER_PLAYLIST_ID] Campaign found: ${campaign.name || 'Unnamed'}`);

          // Step 3: Load all assets inside that campaign
          const campaignObjectId = new mongoose.Types.ObjectId(campaignIdStr);
          const campaignAssets = await Asset.find({ campaignId: campaignObjectId })
            .select("_id name type url thumbnail duration")
            .sort({ createdAt: 1 })
            .lean() as any[];

          console.log(`[PLAYER_PLAYLIST_ID] Step 3: Found ${campaignAssets.length} assets in campaign ${campaign.name}`);

          for (const asset of campaignAssets) {
            const assetIdStr = asset._id.toString();
            
            if (!seenAssetIds.has(assetIdStr)) {
              seenAssetIds.add(assetIdStr);
              const formattedAsset = formatAsset(asset);
              if (formattedAsset) {
                flattenedAssets.push(formattedAsset);
                console.log(`[PLAYER_PLAYLIST_ID] Added asset: ${asset.name || assetIdStr} (${asset.type})`);
              }
            } else {
              console.log(`[PLAYER_PLAYLIST_ID] Skipped duplicate asset: ${asset.name || assetIdStr}`);
            }
          }
        } catch (error: any) {
          console.error(`[PLAYER_PLAYLIST_ID] Error fetching campaign ${campaignIdStr}:`, error);
        }
      }
    }

    // 2. Add direct assets
    if (playlist.assetIds && playlist.assetIds.length > 0) {
      console.log(`[PLAYER_PLAYLIST_ID] Processing ${playlist.assetIds.length} direct assets...`);
      
      const directAssets = await Asset.find({
        _id: { $in: playlist.assetIds },
      })
        .select("_id name type url thumbnail duration")
        .sort({ createdAt: 1 })
        .lean() as any[];

      console.log(`[PLAYER_PLAYLIST_ID] Found ${directAssets.length} direct assets in database`);

      for (const asset of directAssets) {
        const assetIdStr = asset._id.toString();
        
        if (!seenAssetIds.has(assetIdStr)) {
          seenAssetIds.add(assetIdStr);
          const formattedAsset = formatAsset(asset);
          if (formattedAsset) {
            flattenedAssets.push(formattedAsset);
            console.log(`[PLAYER_PLAYLIST_ID] Added direct asset: ${asset.name || assetIdStr} (${asset.type})`);
          }
        } else {
          console.log(`[PLAYER_PLAYLIST_ID] Skipped duplicate direct asset: ${asset.name || assetIdStr}`);
        }
      }
    }

    // 3. Legacy support
    if (
      flattenedAssets.length === 0 &&
      playlist.items &&
      playlist.items.length > 0
    ) {
      console.log(`[PLAYER_PLAYLIST_ID] No campaign/direct assets, using legacy items (${playlist.items.length} items)`);
      
      for (const item of playlist.items) {
        if (item.assetId) {
          try {
            const asset = await Asset.findById(item.assetId).lean() as any;
            if (asset) {
              const assetIdStr = asset._id.toString();
              if (!seenAssetIds.has(assetIdStr)) {
                seenAssetIds.add(assetIdStr);
                const formattedAsset = formatAsset(asset, item.duration);
                if (formattedAsset) {
                  flattenedAssets.push(formattedAsset);
                  console.log(`[PLAYER_PLAYLIST_ID] Added legacy item asset: ${asset.name || assetIdStr}`);
                }
              }
            }
          } catch (error: any) {
            console.error(`[PLAYER_PLAYLIST_ID] Error fetching legacy asset ${item.assetId}:`, error);
          }
        }
      }
    }

    console.log(`[PLAYER_PLAYLIST_ID] Resolved campaign assets:`, flattenedAssets);
    console.log(`[PLAYER_PLAYLIST_ID] Resolved campaign assets:`, flattenedAssets);
    console.log(`[PLAYER_PLAYLIST_ID] Final asset count: ${flattenedAssets.length}`);

    // Return the exact format for Android player
    // Only playlistId and items array - no nested structures
    const response: PlayerPlaylistResponse = {
      playlistId: playlist._id.toString(),
      items: flattenedAssets,
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
