/**
 * Migration Script: Migrate existing assets to Campaign system
 * 
 * This script helps migrate existing assets (without campaignId) to the new
 * Campaign-based system.
 * 
 * What it does:
 * 1. Finds all assets without campaignId
 * 2. Creates a default "Legacy Assets" campaign
 * 3. Assigns orphaned assets to the default campaign
 * 4. Updates any playlists to use the campaign system
 * 
 * Usage:
 *   npx ts-node src/scripts/migrate-to-campaigns.ts
 * 
 * Note: Run this script ONCE after deploying the campaign feature.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Models
import Campaign from "../models/Campaign";
import Asset from "../models/Asset";
import Playlist from "../models/Playlist";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/cms";
const DEFAULT_CAMPAIGN_NAME = "Legacy Assets";
const MAX_ASSETS_PER_CAMPAIGN = 9;

async function migrate() {
  console.log("🚀 Starting Campaign Migration...\n");

  try {
    // Connect to MongoDB
    console.log("📡 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB\n");

    // Step 1: Find assets without campaignId
    console.log("🔍 Finding assets without campaignId...");
    const orphanedAssets = await Asset.find({
      $or: [
        { campaignId: { $exists: false } },
        { campaignId: null },
      ],
    }).lean();

    console.log(`   Found ${orphanedAssets.length} assets without campaignId\n`);

    if (orphanedAssets.length === 0) {
      console.log("✅ No orphaned assets found. Migration not needed.\n");
      await mongoose.disconnect();
      return;
    }

    // Step 2: Create campaign(s) for orphaned assets
    console.log("📦 Creating campaigns for orphaned assets...");
    
    // Group assets into campaigns (max 9 per campaign)
    const numCampaignsNeeded = Math.ceil(orphanedAssets.length / MAX_ASSETS_PER_CAMPAIGN);
    const campaigns: any[] = [];

    for (let i = 0; i < numCampaignsNeeded; i++) {
      const campaignName = numCampaignsNeeded === 1 
        ? DEFAULT_CAMPAIGN_NAME 
        : `${DEFAULT_CAMPAIGN_NAME} ${i + 1}`;

      // Check if campaign already exists
      let campaign = await Campaign.findOne({ name: campaignName });
      
      if (!campaign) {
        campaign = new Campaign({
          name: campaignName,
          description: `Auto-generated campaign for legacy assets migrated from the old system.`,
        });
        await campaign.save();
        console.log(`   ✅ Created campaign: "${campaignName}"`);
      } else {
        console.log(`   ℹ️  Campaign "${campaignName}" already exists`);
      }
      
      campaigns.push(campaign);
    }

    // Step 3: Assign assets to campaigns
    console.log("\n🔄 Assigning assets to campaigns...");
    
    let totalUpdated = 0;
    for (let i = 0; i < orphanedAssets.length; i++) {
      const asset = orphanedAssets[i];
      const campaignIndex = Math.floor(i / MAX_ASSETS_PER_CAMPAIGN);
      const campaign = campaigns[campaignIndex];

      await Asset.updateOne(
        { _id: asset._id },
        { $set: { campaignId: campaign._id } }
      );
      totalUpdated++;

      if (totalUpdated % 10 === 0) {
        console.log(`   Updated ${totalUpdated}/${orphanedAssets.length} assets...`);
      }
    }
    console.log(`   ✅ Updated ${totalUpdated} assets\n`);

    // Step 4: Migrate playlists (if they have old item structure)
    console.log("📋 Checking playlists for migration...");
    
    const playlists = await Playlist.find().lean();
    let playlistsUpdated = 0;

    for (const playlist of playlists) {
      // Check if playlist has old 'items' structure (array with assetId)
      const playlistDoc = playlist as any;
      
      if (playlistDoc.items && Array.isArray(playlistDoc.items) && playlistDoc.items.length > 0) {
        // Get unique campaignIds from the assets in this playlist
        const assetIds = playlistDoc.items.map((item: any) => item.assetId);
        const playlistAssets = await Asset.find({
          _id: { $in: assetIds },
        }).select("campaignId").lean();

        const uniqueCampaignIds = [...new Set(
          playlistAssets
            .filter(a => a.campaignId)
            .map(a => a.campaignId!.toString())
        )];

        // Update playlist to use campaignIds
        await Playlist.updateOne(
          { _id: playlist._id },
          {
            $set: { 
              campaignIds: uniqueCampaignIds.map(id => new mongoose.Types.ObjectId(id)) 
            },
            $unset: { items: "" }, // Remove old items field
          }
        );
        
        playlistsUpdated++;
        console.log(`   ✅ Migrated playlist: "${playlist.name}" (${uniqueCampaignIds.length} campaigns)`);
      } else if (!playlistDoc.campaignIds || playlistDoc.campaignIds.length === 0) {
        // Playlist has no campaigns, add default campaign if available
        if (campaigns.length > 0) {
          await Playlist.updateOne(
            { _id: playlist._id },
            {
              $set: { 
                campaignIds: [campaigns[0]._id] 
              },
            }
          );
          playlistsUpdated++;
          console.log(`   ✅ Added default campaign to playlist: "${playlist.name}"`);
        }
      }
    }

    if (playlistsUpdated === 0) {
      console.log("   ℹ️  No playlists needed migration\n");
    } else {
      console.log(`   ✅ Updated ${playlistsUpdated} playlists\n`);
    }

    // Summary
    console.log("═══════════════════════════════════════════════════════════");
    console.log("                   MIGRATION COMPLETE                       ");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Campaigns created:    ${campaigns.length}`);
    console.log(`  Assets migrated:      ${totalUpdated}`);
    console.log(`  Playlists updated:    ${playlistsUpdated}`);
    console.log("═══════════════════════════════════════════════════════════\n");

    // Disconnect
    await mongoose.disconnect();
    console.log("👋 Disconnected from MongoDB\n");

  } catch (error) {
    console.error("❌ Migration failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run migration
migrate();

