/**
 * Upload Routes
 * 
 * Handles file uploads to S3 for assets.
 * Supports images and videos up to 500MB.
 * 
 * Endpoints:
 *   POST /api/upload          - Upload file and create asset
 *   POST /api/upload/presign  - Get presigned URL for client-side upload
 */

import { Router, Request, Response, NextFunction } from "express";
import { upload, getAssetTypeFromMime, formatFileSize, ALLOWED_MIME_TYPES } from "../middleware/upload";
import { uploadToS3, generateS3Key, getSignedUploadUrl, isS3Configured } from "../utils/s3";
import Asset from "../models/Asset";
import Campaign from "../models/Campaign";
import mongoose from "mongoose";
import { config } from "../config";

const router = Router();

// =============================================================================
// Constants
// =============================================================================

const MAX_ASSETS_PER_CAMPAIGN = 9;

// =============================================================================
// POST /upload - Upload file and create asset
// =============================================================================

/**
 * POST /api/upload
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
  "/",
  (req: Request, res: Response, next: NextFunction) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            success: false,
            message: `File too large. Maximum size is ${formatFileSize(config.upload.maxFileSize)}`,
          });
        }
        if (err.message.includes("File type not allowed")) {
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
          // Continue without thumbnail
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

      // Populate campaign info if applicable
      if (validCampaignId) {
        await asset.populate("campaignId", "name");
      }

      return res.status(201).json({
        success: true,
        message: "File uploaded successfully",
        data: {
          asset: {
            _id: asset._id,
            assetId: asset._id,
            name: asset.name,
            type: asset.type,
            url: asset.url,
            fileUrl: asset.url,
            thumbnail: asset.thumbnail,
            duration: asset.duration,
            size: asset.size,
            fileType: assetType.toLowerCase(),
            campaignId: asset.campaignId,
            userId: asset.userId,
            createdAt: asset.createdAt,
          },
        },
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

// =============================================================================
// POST /upload/presign - Get presigned URL for client-side upload
// =============================================================================

/**
 * POST /api/upload/presign
 * 
 * Get a presigned URL for direct client-side upload to S3.
 * This is useful for large files to avoid server memory issues.
 * 
 * Body:
 *   - filename: Original filename (required)
 *   - contentType: MIME type (required)
 *   - userId: User ID (required)
 *   - campaignId: Campaign ID (optional)
 */
router.post("/presign", async (req: Request, res: Response) => {
  try {
    if (!isS3Configured()) {
      return res.status(503).json({
        success: false,
        message: "File upload service not configured",
      });
    }

    const { filename, contentType, userId, campaignId, size } = req.body;

    if (!filename || !contentType || !userId) {
      return res.status(400).json({
        success: false,
        message: "filename, contentType, and userId are required",
      });
    }

    // Validate content type
    const assetType = getAssetTypeFromMime(contentType);
    if (!assetType) {
      return res.status(400).json({
        success: false,
        message: `Unsupported content type: ${contentType}. Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(", ")}`,
      });
    }

    // Validate file size if provided
    if (size && size > config.upload.maxFileSize) {
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum size is ${formatFileSize(config.upload.maxFileSize)}`,
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

      const assetCount = await Asset.countDocuments({ campaignId });
      if (assetCount >= MAX_ASSETS_PER_CAMPAIGN) {
        return res.status(400).json({
          success: false,
          message: `Maximum ${MAX_ASSETS_PER_CAMPAIGN} assets allowed in one Campaign.`,
        });
      }

      validCampaignId = campaignId;
    }

    // Generate S3 key and presigned URL
    const s3Key = generateS3Key(filename, userId);
    const { signedUrl, publicUrl } = await getSignedUploadUrl(s3Key, contentType);

    return res.status(200).json({
      success: true,
      data: {
        signedUrl,
        publicUrl,
        s3Key,
        assetType,
        campaignId: validCampaignId,
        expiresIn: 3600,
      },
    });
  } catch (error: any) {
    console.error("Presign error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate presigned URL",
      error: config.isDevelopment ? error.message : undefined,
    });
  }
});

// =============================================================================
// POST /upload/confirm - Confirm upload and create asset record
// =============================================================================

/**
 * POST /api/upload/confirm
 * 
 * Confirm a client-side upload completed and create the asset record.
 * Used after presigned URL upload.
 * 
 * Body:
 *   - publicUrl: The S3 public URL
 *   - filename: Original filename
 *   - assetType: IMAGE, VIDEO, HTML, URL
 *   - size: File size in bytes
 *   - userId: User ID
 *   - campaignId: Campaign ID (optional)
 *   - thumbnail: Thumbnail URL (optional)
 */
router.post("/confirm", async (req: Request, res: Response) => {
  try {
    const { publicUrl, filename, assetType, size, userId, campaignId, thumbnail, name } = req.body;

    if (!publicUrl || !filename || !assetType || !userId) {
      return res.status(400).json({
        success: false,
        message: "publicUrl, filename, assetType, and userId are required",
      });
    }

    // Validate asset type
    const validTypes = ["IMAGE", "VIDEO", "HTML", "URL"];
    if (!validTypes.includes(assetType.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid asset type. Must be one of: ${validTypes.join(", ")}`,
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

      validCampaignId = campaignId;
    }

    // Create asset record
    const asset = new Asset({
      name: name || filename,
      type: assetType.toUpperCase(),
      url: publicUrl,
      thumbnail: thumbnail || null,
      duration: assetType.toUpperCase() === "VIDEO" ? 1 : 10,
      size: size || 0,
      userId,
      campaignId: validCampaignId,
    });

    await asset.save();

    return res.status(201).json({
      success: true,
      message: "Asset created successfully",
      data: {
        asset: {
          _id: asset._id,
          assetId: asset._id,
          name: asset.name,
          type: asset.type,
          url: asset.url,
          fileUrl: asset.url,
          thumbnail: asset.thumbnail,
          duration: asset.duration,
          size: asset.size,
          fileType: asset.type.toLowerCase(),
          campaignId: asset.campaignId,
          userId: asset.userId,
          createdAt: asset.createdAt,
        },
      },
    });
  } catch (error: any) {
    console.error("Confirm upload error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create asset record",
      error: config.isDevelopment ? error.message : undefined,
    });
  }
});

// =============================================================================
// GET /upload/config - Get upload configuration
// =============================================================================

/**
 * GET /api/upload/config
 * 
 * Returns the upload configuration (max size, allowed types, etc.)
 */
router.get("/config", (req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    config: {
      maxFileSize: config.upload.maxFileSize,
      maxFileSizeFormatted: formatFileSize(config.upload.maxFileSize),
      allowedMimeTypes: Object.keys(ALLOWED_MIME_TYPES),
      allowedExtensions: config.upload.allowedExtensions,
      s3Configured: isS3Configured(),
    },
  });
});

export const uploadRoutes = router;
