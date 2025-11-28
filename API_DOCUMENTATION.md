# CMS Backend API Documentation

## 📋 Project Analysis Summary

**Project:** CMS Backend for Digital Signage (Orion-Connect)  
**Framework:** Express.js + TypeScript  
**Database:** MongoDB (Mongoose ODM)  
**Email Service:** Resend

---

## 🌐 Base URLs

| Environment | Base URL |
|-------------|----------|
| **Development** | `http://localhost:5000` |
| **Production (Render)** | `https://cms-backend-9r1u.onrender.com` |

### For Flutter/Android App:
```dart
// Development
const String BASE_URL = "http://10.0.2.2:5000";  // Android Emulator
const String BASE_URL = "http://localhost:5000"; // iOS Simulator

// Production (Render)
const String BASE_URL = "https://cms-backend-9r1u.onrender.com";
```

---

## 🔌 API Endpoints

### Health & Info

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |
| GET | `/api` | API information & available endpoints |

### Display Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/displays/playback` | Track display playback activity |
| GET | `/api/displays/device/:deviceId` | Get display details with playlist |

### Playback Logging (Proof-of-Play)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/playback/log` | Log single or bulk playback events |
| GET | `/api/playback/report` | Get aggregated playback reports |
| GET | `/api/playback/stats` | Get quick overall statistics |

### Assets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/assets` | List all assets with pagination |
| GET | `/api/assets/:id` | Get single asset by ID |
| GET | `/api/assets/:id/download` | Download/redirect to asset URL |
| GET | `/api/assets/by-name/:name` | Get asset by name |
| POST | `/api/assets` | Create new asset |
| PUT | `/api/assets/:id` | Update asset |
| DELETE | `/api/assets/:id` | Delete asset |
| GET | `/api/assets/stats/summary` | Get asset statistics |

### Email

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/email/quote-request` | Submit quote request |
| POST | `/api/email/quota` | (Deprecated) Alias for quote-request |

---

## 📝 Detailed Endpoint Documentation

### 1. Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-28T12:00:00.000Z",
  "environment": "development",
  "uptime": 3600.5
}
```

---

### 2. Track Display Playback
```http
POST /api/displays/playback
Content-Type: application/json
```

**Request Body:**
```json
{
  "deviceId": "PLAYER_01"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Playback tracked successfully",
  "lastActive": "2025-11-28T12:00:00.000Z",
  "totalHours": 120
}
```

---

### 3. Get Display by Device ID
```http
GET /api/displays/device/:deviceId
```

**Response (200):**
```json
{
  "displayId": "507f1f77bcf86cd799439011",
  "name": "Lobby Display",
  "resolution": "1920x1080",
  "playlist": {
    "_id": "507f1f77bcf86cd799439012",
    "name": "Main Playlist",
    "description": "Default lobby content",
    "status": "active",
    "items": [
      {
        "assetId": {
          "_id": "507f1f77bcf86cd799439013",
          "name": "Welcome Video",
          "type": "VIDEO",
          "url": "https://cdn.example.com/video.mp4",
          "thumbnail": "https://cdn.example.com/thumb.jpg",
          "duration": 30,
          "size": 15000000
        },
        "duration": 30,
        "order": 1
      }
    ],
    "schedule": {}
  }
}
```

---

### 4. Log Playback Events
```http
POST /api/playback/log
Content-Type: application/json
```

**Request Body (Single):**
```json
{
  "device_id": "PLAYER_01",
  "asset_id": "video1.mp4",
  "playlist_id": "PL05",
  "start_time": "2025-11-28T10:00:00Z",
  "end_time": "2025-11-28T10:00:30Z",
  "duration": 30
}
```

**Request Body (Bulk):**
```json
[
  {
    "device_id": "PLAYER_01",
    "asset_id": "video1.mp4",
    "start_time": "2025-11-28T10:00:00Z",
    "end_time": "2025-11-28T10:00:30Z",
    "duration": 30
  },
  {
    "device_id": "PLAYER_02",
    "asset_id": "image1.jpg",
    "start_time": "2025-11-28T10:00:30Z",
    "end_time": "2025-11-28T10:00:45Z",
    "duration": 15
  }
]
```

**Response (201):**
```json
{
  "success": true,
  "count": 2,
  "message": "Successfully logged 2 playback event(s)"
}
```

---

### 5. Get Playback Report
```http
GET /api/playback/report?device_id=PLAYER_01&date_from=2025-11-01T00:00:00Z&date_to=2025-11-30T23:59:59Z&page=1&limit=50
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| device_id | string | No | Filter by device |
| asset_id | string | No | Filter by asset |
| playlist_id | string | No | Filter by playlist |
| date_from | ISO date | No | Start date |
| date_to | ISO date | No | End date |
| page | number | No | Page number (default: 1) |
| limit | number | No | Results per page (default: 50, max: 1000) |

**Response (200):**
```json
{
  "success": true,
  "summary": [
    {
      "asset_id": "video1.mp4",
      "play_count": 32,
      "total_duration": 850,
      "first_played": "2025-11-01T08:00:00.000Z",
      "last_played": "2025-11-28T18:30:00.000Z",
      "unique_device_count": 5
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 10,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPrevPage": false
  },
  "filters": {
    "device_id": "PLAYER_01",
    "asset_id": null,
    "playlist_id": null,
    "date_from": "2025-11-01T00:00:00Z",
    "date_to": "2025-11-30T23:59:59Z"
  }
}
```

---

### 6. Get Playback Stats
```http
GET /api/playback/stats?date_from=2025-11-01T00:00:00Z&date_to=2025-11-30T23:59:59Z
```

**Response (200):**
```json
{
  "success": true,
  "stats": {
    "total_plays": 1250,
    "total_duration": 45000,
    "unique_asset_count": 25,
    "unique_device_count": 10,
    "unique_playlist_count": 5,
    "earliest_play": "2025-11-01T08:00:00.000Z",
    "latest_play": "2025-11-28T18:30:00.000Z"
  },
  "filters": {
    "date_from": "2025-11-01T00:00:00Z",
    "date_to": "2025-11-30T23:59:59Z"
  }
}
```

---

### 7. List Assets
```http
GET /api/assets?type=VIDEO&page=1&limit=20&search=promo
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| type | string | No | Filter by type (IMAGE, VIDEO, HTML, URL) |
| userId | string | No | Filter by user ID |
| search | string | No | Search by name |
| page | number | No | Page number (default: 1) |
| limit | number | No | Results per page (default: 20, max: 100) |
| sortBy | string | No | Sort field (default: createdAt) |
| sortOrder | string | No | asc or desc (default: desc) |

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439013",
      "name": "Welcome Video",
      "type": "VIDEO",
      "url": "https://cdn.example.com/video.mp4",
      "thumbnail": "https://cdn.example.com/thumb.jpg",
      "duration": 30,
      "size": 15000000,
      "userId": "user123",
      "createdAt": "2025-11-28T10:00:00.000Z",
      "updatedAt": "2025-11-28T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 50,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

### 8. Get Asset by ID
```http
GET /api/assets/:id
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439013",
    "name": "Welcome Video",
    "type": "VIDEO",
    "url": "https://cdn.example.com/video.mp4",
    "thumbnail": "https://cdn.example.com/thumb.jpg",
    "duration": 30,
    "size": 15000000,
    "userId": "user123"
  }
}
```

---

### 9. Download Asset
```http
GET /api/assets/:id/download
GET /api/assets/:id/download?redirect=false
```

**With redirect=true (default):** Redirects to asset URL  
**With redirect=false:** Returns JSON with download URL

**Response (redirect=false):**
```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439013",
    "name": "Welcome Video",
    "type": "VIDEO",
    "url": "https://cdn.example.com/video.mp4",
    "size": 15000000,
    "downloadUrl": "https://cdn.example.com/video.mp4"
  }
}
```

---

### 10. Get Asset by Name
```http
GET /api/assets/by-name/:name
```

**Example:** `GET /api/assets/by-name/welcome-video.mp4`

---

### 11. Create Asset
```http
POST /api/assets
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Promo Video",
  "type": "VIDEO",
  "url": "https://cdn.example.com/promo.mp4",
  "thumbnail": "https://cdn.example.com/promo-thumb.jpg",
  "duration": 45,
  "size": 25000000,
  "userId": "user123"
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Asset created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439014",
    "name": "Promo Video",
    "type": "VIDEO",
    "url": "https://cdn.example.com/promo.mp4",
    ...
  }
}
```

---

### 12. Update Asset
```http
PUT /api/assets/:id
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Updated Video Name",
  "duration": 60
}
```

---

### 13. Delete Asset
```http
DELETE /api/assets/:id
```

**Response (200):**
```json
{
  "success": true,
  "message": "Asset deleted successfully",
  "data": { "id": "507f1f77bcf86cd799439013" }
}
```

---

### 14. Asset Statistics
```http
GET /api/assets/stats/summary
```

**Response (200):**
```json
{
  "success": true,
  "stats": {
    "totalAssets": 150,
    "totalSize": 5368709120,
    "totalSizeMB": 5120
  },
  "byType": [
    { "type": "VIDEO", "count": 80, "totalSize": 4294967296, "totalSizeMB": 4096 },
    { "type": "IMAGE", "count": 50, "totalSize": 524288000, "totalSizeMB": 500 },
    { "type": "HTML", "count": 20, "totalSize": 549453824, "totalSizeMB": 524 }
  ]
}
```

---

### 15. Submit Quote Request
```http
POST /api/email/quote-request
Content-Type: application/json
```

**Request Body:**
```json
{
  "product": {
    "id": "PROD001",
    "name": "LED Display Panel",
    "category": "Indoor",
    "pixelPitch": 2.5,
    "resolution": { "width": 1920, "height": 1080 },
    "cabinetDimensions": { "width": 500, "height": 500 },
    "moduleDimensions": { "width": 250, "height": 250 },
    "moduleResolution": { "width": 128, "height": 128 },
    "moduleQuantity": 4,
    "pixelDensity": 160,
    "brightness": 1000,
    "refreshRate": 3840,
    "environment": "Indoor",
    "maxPowerConsumption": 450,
    "avgPowerConsumption": 150,
    "weightPerCabinet": 8.5,
    "userType": "endUser"
  },
  "customerName": "John Doe",
  "customerEmail": "john@example.com",
  "customerPhone": "+91-9876543210",
  "message": "I need a quote for 10 panels.",
  "cabinetGrid": { "columns": 5, "rows": 2 },
  "displaySize": { "width": 2.5, "height": 1.0 },
  "aspectRatio": "16:9"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Quote request submitted successfully",
  "data": { "id": "email_id_from_resend" }
}
```

---

## ⚙️ Required Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Environment mode |
| `PORT` | No | `5000` | Server port |
| `MONGODB_URI` | **Yes** | `mongodb://localhost:27017/cms` | MongoDB connection string |
| `RESEND_API_KEY` | **Production** | - | Resend API key for emails |
| `TO_EMAIL` | **Production** | - | Quote request recipient |
| `DEFAULT_FROM_EMAIL` | No | `Orion-Connect <no-reply@orionconnect.in>` | Sender email |
| `CORS_ORIGINS` | No | `localhost:3000,5173,8080` | Allowed CORS origins |
| `RATE_LIMIT_WINDOW_MS` | No | `900000` | Rate limit window (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Max requests per window |
| `API_BASE_URL` | No | `http://localhost:5000` | API base URL |

---

## 🔒 Security Features

✅ **Helmet** - Security HTTP headers  
✅ **CORS** - Configurable cross-origin resource sharing  
✅ **Rate Limiting** - 100 requests per 15 minutes per IP  
✅ **Input Validation** - Request body validation  
✅ **Error Handling** - Global error handler with sanitized responses  
✅ **Graceful Shutdown** - Clean server shutdown on SIGTERM/SIGINT  

---

## 🚀 Deployment Checklist

1. [ ] Set `NODE_ENV=production`
2. [ ] Configure production `MONGODB_URI` (MongoDB Atlas recommended)
3. [ ] Set `RESEND_API_KEY` and `TO_EMAIL`
4. [ ] Configure `CORS_ORIGINS` with production domains
5. [ ] Set `API_BASE_URL` to production URL
6. [ ] Reduce `RATE_LIMIT_MAX_REQUESTS` for stricter limits
7. [ ] Use process manager (PM2) or containerization (Docker)
8. [ ] Set up reverse proxy (nginx) for SSL termination
9. [ ] Enable MongoDB Atlas IP whitelist or VPC peering
10. [ ] Set up monitoring and logging (e.g., PM2, Datadog, New Relic)

---

## 📁 Project Structure

```
cms-backend/
├── src/
│   ├── config/
│   │   └── index.ts          # Centralized configuration
│   ├── controllers/
│   │   ├── display.controller.ts
│   │   └── emailController.ts
│   ├── middleware/
│   │   └── errorHandler.ts   # Global error handling
│   ├── models/
│   │   ├── Asset.ts
│   │   ├── Display.ts
│   │   ├── PlaybackLog.ts
│   │   └── Playlist.ts
│   ├── routes/
│   │   ├── display.routes.ts
│   │   ├── email.routes.ts
│   │   └── playbackLogs.ts
│   └── index.ts              # Main entry point
├── postman/
│   └── Playback-Logs-API.postman_collection.json
├── .env.example              # Environment template
├── .env.production           # Production template
├── package.json
├── tsconfig.json
└── README.md
```
