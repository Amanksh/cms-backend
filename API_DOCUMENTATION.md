# CMS Backend API Documentation v2.0

## Campaign-Based Content Management System

This API provides endpoints for managing digital signage content through a **Campaign-based system**. The backend is synchronized with the CMS Frontend (Next.js dashboard).

### Key Concepts

- **Campaign**: A container for assets (images, videos, URLs). Users must create a Campaign before uploading any asset.
- **Asset**: Media content (IMAGE, VIDEO, HTML, URL) that belongs to a Campaign.
- **Playlist**: A collection of Campaigns (up to 7) that plays on digital signage displays.
- **Display**: A digital signage device that can have a playlist assigned.

### Validation Rules

| Rule | Limit |
|------|-------|
| Max assets per Campaign | 9 |
| Max Campaigns per Playlist | 7 |
| Campaign name | Unique per user |
| Asset upload | Requires Campaign ID |
| Device ID | Unique globally |

---

## Base URL

```
Production: https://your-api-domain.com/api
Development: http://localhost:5000/api
```

---

## Campaigns API

### Create Campaign

Creates a new Campaign. Campaign name must be unique per user.

**Endpoint:** `POST /api/campaigns`

**Request Body:**
```json
{
  "name": "Summer Sale 2024",
  "description": "Promotional content for summer sale",
  "userId": "user123"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Campaign created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Summer Sale 2024",
    "description": "Promotional content for summer sale",
    "userId": "user123",
    "createdAt": "2024-01-15T10:00:00.000Z",
    "updatedAt": "2024-01-15T10:00:00.000Z",
    "assetCount": 0,
    "maxAssets": 9,
    "previewAssets": [],
    "canAddMoreAssets": true
  }
}
```

**Error (409 - Duplicate Name):**
```json
{
  "success": false,
  "message": "A campaign with this name already exists"
}
```

---

### List Campaigns

Returns all campaigns with asset counts and preview thumbnails.

**Endpoint:** `GET /api/campaigns`

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| userId | string | - | Filter by user ID (recommended) |
| search | string | - | Search by name |
| page | number | 1 | Page number |
| limit | number | 20 | Results per page (max 100) |
| sortBy | string | createdAt | Sort field |
| sortOrder | string | desc | asc or desc |

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Summer Sale 2024",
      "description": "Promotional content",
      "userId": "user123",
      "assetCount": 5,
      "maxAssets": 9,
      "canAddMoreAssets": true,
      "previewAssets": [
        {
          "_id": "asset123",
          "name": "Banner 1",
          "type": "IMAGE",
          "thumbnail": "https://...",
          "url": "https://..."
        }
      ],
      "createdAt": "2024-01-15T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPrevPage": false
  },
  "filters": {
    "userId": "user123",
    "search": null
  }
}
```

---

### Get Campaign Details

Returns a single campaign with all its assets.

**Endpoint:** `GET /api/campaigns/:id`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Summer Sale 2024",
    "description": "Promotional content",
    "userId": "user123",
    "assetCount": 5,
    "maxAssets": 9,
    "canAddMoreAssets": true,
    "assets": [
      {
        "_id": "asset123",
        "name": "Banner 1",
        "type": "IMAGE",
        "url": "https://...",
        "duration": 10,
        "size": 1024000
      }
    ],
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
}
```

---

### Update Campaign

**Endpoint:** `PUT /api/campaigns/:id`

**Request Body:**
```json
{
  "name": "Updated Campaign Name",
  "description": "Updated description"
}
```

---

### Delete Campaign

Deletes a campaign and all its assets. Cannot delete if campaign is assigned to any playlist.

**Endpoint:** `DELETE /api/campaigns/:id`

**Response (200):**
```json
{
  "success": true,
  "message": "Campaign deleted successfully",
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Summer Sale 2024",
    "deletedAssetsCount": 5
  }
}
```

**Error (400 - Assigned to Playlist):**
```json
{
  "success": false,
  "message": "Cannot delete campaign. It is currently assigned to a playlist. Remove it from the playlist first."
}
```

---

## Assets API

### Create Asset (Requires Campaign)

Creates a new asset. **Campaign ID is required.**

**Endpoint:** `POST /api/assets`

**Request Body:**
```json
{
  "name": "Hero Banner",
  "type": "IMAGE",
  "url": "https://storage.example.com/banner.jpg",
  "thumbnail": "https://storage.example.com/banner-thumb.jpg",
  "duration": 10,
  "size": 1024000,
  "userId": "user123",
  "campaignId": "507f1f77bcf86cd799439011"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Asset created successfully",
  "data": {
    "_id": "asset123",
    "name": "Hero Banner",
    "type": "IMAGE",
    "url": "https://...",
    "campaignId": {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Summer Sale 2024"
    }
  },
  "campaignInfo": {
    "campaignId": "507f1f77bcf86cd799439011",
    "campaignName": "Summer Sale 2024",
    "assetCount": 3,
    "maxAssets": 9,
    "remainingSlots": 6
  }
}
```

**Error (400 - No Campaign):**
```json
{
  "success": false,
  "message": "Please create a Campaign first."
}
```

**Error (400 - Campaign Full):**
```json
{
  "success": false,
  "message": "Maximum 9 assets allowed in one Campaign.",
  "currentCount": 9,
  "maxAllowed": 9
}
```

---

### List Assets

**Endpoint:** `GET /api/assets`

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| type | string | Filter by type (IMAGE, VIDEO, HTML, URL) |
| userId | string | Filter by user |
| campaignId | string | Filter by campaign |
| search | string | Search by name |
| page | number | Page number |
| limit | number | Results per page |

---

### Get Asset

**Endpoint:** `GET /api/assets/:id`

---

### Update Asset

**Endpoint:** `PUT /api/assets/:id`

Note: When changing `campaignId`, the target campaign's asset limit is validated.

---

### Delete Asset

**Endpoint:** `DELETE /api/assets/:id`

---

## Playlists API

### Create Playlist

Creates a playlist with selected campaigns (max 7).

**Endpoint:** `POST /api/playlists`

**Request Body:**
```json
{
  "name": "Lobby Display",
  "description": "Content for main lobby screen",
  "userId": "user123",
  "status": "active",
  "campaignIds": [
    "507f1f77bcf86cd799439011",
    "507f1f77bcf86cd799439012"
  ],
  "schedule": {
    "startDate": "2024-01-15",
    "endDate": "2024-02-15",
    "daysOfWeek": [1, 2, 3, 4, 5],
    "startTime": "09:00",
    "endTime": "18:00"
  }
}
```

**Error (400 - Too Many Campaigns):**
```json
{
  "success": false,
  "message": "Maximum 7 campaigns allowed in one playlist.",
  "provided": 8,
  "maxAllowed": 7
}
```

---

### List Playlists

**Endpoint:** `GET /api/playlists`

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| userId | string | Filter by user |
| status | string | Filter by status |
| search | string | Search by name |

Returns playlists with campaign summaries and total asset counts.

---

### Get Playlist Details

Returns playlist with all campaigns and their assets expanded.

**Endpoint:** `GET /api/playlists/:id`

---

### Update Playlist

**Endpoint:** `PUT /api/playlists/:id`

---

### Delete Playlist

**Endpoint:** `DELETE /api/playlists/:id`

---

### Add Campaign to Playlist

**Endpoint:** `POST /api/playlists/:id/campaigns`

**Request Body:**
```json
{
  "campaignId": "507f1f77bcf86cd799439011"
}
```

---

### Remove Campaign from Playlist

**Endpoint:** `DELETE /api/playlists/:id/campaigns/:campaignId`

---

## Player API (For Android/Digital Signage)

These endpoints are designed for player devices to fetch content.

### Get Playlist for Player

Returns fully expanded playlist with all assets in playback order.

**Endpoint:** `GET /api/player/playlist`

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| playlistId | string | Playlist ID |
| deviceId | string | Device ID (alternative to playlistId) |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "playlistId": "playlist123",
    "playlistName": "Lobby Display",
    "status": "active",
    "totalAssets": 15,
    "totalDuration": 180,
    "assets": [
      {
        "assetId": "asset123",
        "name": "Summer Banner",
        "campaignId": "campaign1",
        "campaignName": "Summer Sale 2024",
        "type": "IMAGE",
        "url": "https://storage.example.com/banner.jpg",
        "localPath": "https://storage.example.com/banner.jpg",
        "thumbnail": "https://...",
        "duration": 10,
        "size": 1024000,
        "order": 0
      }
    ],
    "campaigns": [
      {
        "id": "campaign1",
        "name": "Summer Sale 2024",
        "assetCount": 5
      }
    ],
    "schedule": {
      "startDate": "2024-01-15T00:00:00.000Z",
      "endDate": "2024-02-15T00:00:00.000Z",
      "daysOfWeek": [1, 2, 3, 4, 5],
      "startTime": "09:00",
      "endTime": "18:00"
    },
    "updatedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

---

### Get Playlist by ID (Alternative)

**Endpoint:** `GET /api/player/playlist/:id`

---

### List All Campaigns (For Player Caching)

**Endpoint:** `GET /api/player/campaigns`

---

### Get Asset Details (For Player)

**Endpoint:** `GET /api/player/asset/:id`

---

## Playback Logging API

### Log Playback Event

**Endpoint:** `POST /api/playback/log`

**Request Body (Single):**
```json
{
  "device_id": "PLAYER_01",
  "asset_id": "asset123",
  "playlist_id": "playlist123",
  "start_time": "2024-01-15T10:00:00Z",
  "end_time": "2024-01-15T10:00:30Z",
  "duration": 30
}
```

**Request Body (Bulk):**
```json
[
  { "device_id": "PLAYER_01", "asset_id": "asset1", ... },
  { "device_id": "PLAYER_01", "asset_id": "asset2", ... }
]
```

---

### Get Playback Report

**Endpoint:** `GET /api/playback/report`

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| device_id | string | Filter by device |
| asset_id | string | Filter by asset |
| playlist_id | string | Filter by playlist |
| date_from | string | Start date (ISO) |
| date_to | string | End date (ISO) |
| page | number | Page number |
| limit | number | Results per page |

---

### Get Playback Stats

**Endpoint:** `GET /api/playback/stats`

---

## Displays API

### List Displays

**Endpoint:** `GET /api/displays`

---

### Create Display

**Endpoint:** `POST /api/displays`

---

### Get Display

**Endpoint:** `GET /api/displays/:id`

---

### Update Display

**Endpoint:** `PATCH /api/displays/:id`

---

### Delete Display

**Endpoint:** `DELETE /api/displays/:id`

---

## Error Codes

| Code | Description |
|------|-------------|
| 400 | Bad Request - Invalid input or validation error |
| 401 | Unauthorized - Missing or invalid authentication |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Duplicate name or constraint violation |
| 500 | Internal Server Error |

---

## Frontend Synchronization

This backend is synchronized with the CMS Frontend (Next.js). Both systems:
- Connect to the same MongoDB database
- Use identical model structures
- Share validation rules

See `docs/FRONTEND_BACKEND_SYNC.md` for detailed synchronization information.
