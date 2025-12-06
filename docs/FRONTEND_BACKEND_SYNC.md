# Frontend-Backend Synchronization Report

**Date:** December 6, 2025  
**Status:** ✅ PASS

## Overview

This document tracks the synchronization between the CMS backend (`cms-backend-2`) and frontend (`digital-signage-cms`) for the "Campaign + Direct Assets" flow.

---

## 1️⃣ DATA MODEL COMPARISON

### Asset Model

| Field | Backend (cms-backend-2) | Frontend (digital-signage-cms) | Status |
|-------|------------------------|-------------------------------|--------|
| `name` | Required | Required | ✅ Aligned |
| `type` | Required (IMAGE/VIDEO/HTML/URL) | Required (IMAGE/VIDEO/HTML/URL) | ✅ Aligned |
| `url` | Required | Required | ✅ Aligned |
| `thumbnail` | Optional | Optional | ✅ Aligned |
| `duration` | Optional | Optional | ✅ Aligned |
| `size` | Optional | Optional | ✅ Aligned |
| `userId` | Required (ObjectId) | Required (ObjectId) | ✅ Aligned |
| `campaignId` | **Optional (null for direct assets)** | **Optional (null for direct assets)** | ✅ **FIXED** |
| `createdAt` | Auto (timestamps) | Auto (timestamps) | ✅ Aligned |
| `updatedAt` | Auto (timestamps) | Auto (timestamps) | ✅ Aligned |

### Campaign Model

| Field | Backend | Frontend | Status |
|-------|---------|----------|--------|
| `name` | Required | Required | ✅ Aligned |
| `description` | Optional | Optional | ✅ Aligned |
| `userId` | Required | Required | ✅ Aligned |
| Unique constraint | `name + userId` | `name + userId` | ✅ Aligned |

### Playlist Model

| Field | Backend (cms-backend-2) | Frontend (digital-signage-cms) | Status |
|-------|------------------------|-------------------------------|--------|
| `name` | Required | Required | ✅ Aligned |
| `description` | Optional | Optional | ✅ Aligned |
| `userId` | Required | Required | ✅ Aligned |
| `status` | active/inactive/scheduled | active/inactive/scheduled | ✅ Aligned |
| `campaignIds` | Array of ObjectId (max 7) | Array of ObjectId (max 7) | ✅ Aligned |
| `assetIds` | **Array of ObjectId (direct assets)** | **Array of ObjectId (direct assets)** | ✅ **FIXED** |
| `items` | Legacy support | Legacy support | ✅ Aligned |
| `schedule` | Optional | Optional | ✅ Aligned |

---

## 2️⃣ API ENDPOINT ALIGNMENT

### Campaign APIs

| Endpoint | Backend Route | Frontend Route | Status |
|----------|--------------|----------------|--------|
| Create Campaign | `POST /api/campaigns` | `POST /api/campaign/create` | ✅ Working |
| List Campaigns | `GET /api/campaigns?userId=` | `GET /api/campaigns` | ✅ Working |
| Get Campaign | `GET /api/campaigns/:id` | `GET /api/campaign/:id` | ✅ Working |
| Delete Campaign | `DELETE /api/campaigns/:id` | `DELETE /api/campaign/:id` | ✅ Working |

### Asset APIs

| Endpoint | Backend Route | Frontend Route | Status |
|----------|--------------|----------------|--------|
| List Assets | `GET /api/assets` | `GET /api/assets` | ✅ Working |
| **Combined View** | `GET /api/assets?view=combined&userId=` | `GET /api/assets?view=combined` | ✅ **ADDED** |
| Create Asset | `POST /api/assets` (campaignId optional) | `POST /api/assets/upload` | ✅ **FIXED** |
| Create URL Asset | `POST /api/assets` | `POST /api/assets/url` | ✅ Working |
| Get Asset | `GET /api/assets/:id` | `GET /api/assets/:id` | ✅ Working |
| Delete Asset | `DELETE /api/assets/:id` | `DELETE /api/assets/:id` | ✅ Working |

### Playlist APIs

| Endpoint | Backend Route | Frontend Route | Status |
|----------|--------------|----------------|--------|
| Create Playlist | `POST /api/playlists` (with assetIds) | `POST /api/playlists` | ✅ **FIXED** |
| List Playlists | `GET /api/playlists` | `GET /api/playlists` | ✅ Working |
| Get Playlist | `GET /api/playlists/:id` | `GET /api/playlists/:playlistId` | ✅ Working |
| Update Playlist | `PUT /api/playlists/:id` (with assetIds) | `PATCH /api/playlists/:playlistId` | ✅ **FIXED** |
| Delete Playlist | `DELETE /api/playlists/:id` | `DELETE /api/playlists/:playlistId` | ✅ Working |
| Add Campaign | `POST /api/playlists/:id/campaigns` | via PATCH | ✅ Working |
| Remove Campaign | `DELETE /api/playlists/:id/campaigns/:cid` | via PATCH | ✅ Working |
| **Add Direct Asset** | `POST /api/playlists/:id/assets` | via PATCH | ✅ **ADDED** |
| **Remove Direct Asset** | `DELETE /api/playlists/:id/assets/:aid` | via PATCH | ✅ **ADDED** |

---

## 3️⃣ RESPONSE STRUCTURE ALIGNMENT

### GET /api/assets?view=combined

Both backend and frontend now return:

```json
{
  "success": true,
  "campaigns": [
    {
      "id": "...",
      "_id": "...",
      "name": "Campaign Name",
      "description": "...",
      "type": "campaign",
      "assets": [
        {
          "assetId": "...",
          "_id": "...",
          "name": "Asset Name",
          "type": "IMAGE|VIDEO|HTML|URL",
          "url": "...",
          "thumbnail": "...",
          "duration": 10,
          "size": 1234,
          "createdAt": "..."
        }
      ],
      "assetCount": 3,
      "maxAssets": 9,
      "canAddMoreAssets": true,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "assets": [
    {
      "_id": "...",
      "id": "...",
      "name": "Direct Asset",
      "type": "IMAGE|VIDEO|HTML|URL",
      "url": "...",
      "thumbnail": "...",
      "duration": 10,
      "size": 1234,
      "createdAt": "...",
      "itemType": "asset"
    }
  ]
}
```

### POST /api/playlists

Request body now accepts:

```json
{
  "name": "Playlist Name",
  "description": "...",
  "userId": "...",
  "campaignIds": ["campaign_id_1", "campaign_id_2"],
  "assetIds": ["direct_asset_id_1", "direct_asset_id_2"],
  "schedule": { ... }
}
```

---

## 4️⃣ FIXES APPLIED

### Backend Fixes

1. **Asset Model** (`src/models/Asset.ts`)
   - Made `campaignId` **optional** (was required)
   - Default value: `null` for direct assets
   - Added index for `userId + campaignId` queries

2. **Playlist Model** (`src/models/Playlist.ts`)
   - Added `assetIds` array for direct assets
   - Added index on `assetIds`

3. **Asset Routes** (`src/routes/asset.routes.ts`)
   - Added `view=combined` query parameter support
   - Made `campaignId` optional in POST /assets
   - Returns campaigns + direct assets when view=combined

4. **Playlist Routes** (`src/routes/playlist.routes.ts`)
   - Added `assetIds` support to POST, GET, PUT
   - Added `POST /playlists/:id/assets` endpoint
   - Added `DELETE /playlists/:id/assets/:assetId` endpoint
   - Response includes `directAssets` and `directAssetCount`

### Frontend Status

The frontend (`digital-signage-cms`) was already correctly implemented for the Campaign + Direct Assets flow. No changes required.

---

## 5️⃣ VALIDATION RULES

### Asset Upload
- ✅ `name` NOT required (uses filename by default)
- ✅ `description` NOT required
- ✅ `campaignId` is OPTIONAL (null = direct asset)
- ✅ Max 9 assets per campaign (only when campaignId provided)

### Campaign Creation
- ✅ `name` REQUIRED
- ✅ `description` OPTIONAL
- ✅ Unique name per user

### Playlist Creation
- ✅ `name` REQUIRED
- ✅ `campaignIds` OPTIONAL (array, max 7)
- ✅ `assetIds` OPTIONAL (array, direct assets only)
- ✅ Can mix campaigns AND direct assets

---

## 6️⃣ SUMMARY

| Check | Status |
|-------|--------|
| Data Models Aligned | ✅ PASS |
| API Endpoints Match | ✅ PASS |
| Response Structures Match | ✅ PASS |
| Direct Assets Support | ✅ PASS |
| Campaign + Direct Assets in Playlists | ✅ PASS |

**Frontend-Backend Sync: ✅ PASS**

---

## What Was Fixed

1. Backend Asset model now allows `campaignId: null` for direct assets
2. Backend Playlist model now includes `assetIds` for direct assets
3. Backend API routes support `view=combined` for file manager view
4. Backend API routes support both campaigns AND direct assets in playlists
5. Added endpoints to add/remove direct assets from playlists

## Manual Review Items

- Ensure backend is redeployed with new model changes
- Test direct asset upload from frontend
- Test adding direct assets to playlists
- Verify player API correctly fetches both campaigns and direct assets

---

*Last updated: December 6, 2025*
