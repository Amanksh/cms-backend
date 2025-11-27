# Origins CMS Backend

A Content Management System (CMS) backend for managing digital displays and handling quote requests. This API provides endpoints for display management and email notifications.

## Table of Contents

- [Getting Started](#getting-started)
- [API Documentation](#api-documentation)
  - [Display Endpoints](#display-endpoints)
  - [Playback Logs (Proof-of-Play)](#playback-logs-proof-of-play)
  - [Email Endpoints](#email-endpoints)
- [Environment Variables](#environment-variables)
- [Error Handling](#error-handling)
- [Postman Collection](#postman-collection)

## Getting Started

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file based on `.env.example`
4. Start the development server:
   ```bash
   npm run dev
   ```

## API Documentation

### Base URL
All endpoints are prefixed with `/api`.

### Display Endpoints

#### 1. Track Display Playback

Track display activity and update last active timestamp.

- **Endpoint:** `POST /api/display/playback`
- **Request Body:**
  ```json
  {
    "deviceId": "string (required)"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Playback tracked successfully",
    "lastActive": "2023-01-01T12:00:00.000Z",
    "totalHours": 24
  }
  ```
- **Error Responses:**
  - `404 Not Found`: Display not found
  - `500 Internal Server Error`: Server error occurred

#### 2. Get Display by Device ID

Retrieve display details including assigned playlist and assets.

- **Endpoint:** `GET /api/display/device/:deviceId`
- **URL Parameters:**
  - `deviceId`: string (required)
- **Success Response (200 OK):**
  ```json
  {
    "displayId": "string",
    "name": "string",
    "resolution": "string",
    "playlist": {
      "_id": "string",
      "name": "string",
      "description": "string",
      "status": "string",
      "items": [
        {
          "assetId": {
            "_id": "string",
            "name": "string",
            "type": "string",
            "url": "string",
            "thumbnail": "string",
            "duration": number,
            "size": number
          },
          "duration": number,
          "order": number
        }
      ],
      "schedule": {}
    }
  }
  ```
- **Error Responses:**
  - `404 Not Found`: Display not found
  - `500 Internal Server Error`: Server error occurred

### Playback Logs (Proof-of-Play)

The Proof-of-Play system tracks all playback events from digital signage players for reporting and analytics.

#### 1. Log Playback Event(s)

Log single or multiple playback events from players.

- **Endpoint:** `POST /api/playback/log`
- **Request Body (Single):**
  ```json
  {
    "device_id": "PLAYER_01",
    "asset_id": "video1.mp4",
    "playlist_id": "PL05",
    "start_time": "2025-11-26T10:00:00Z",
    "end_time": "2025-11-26T10:00:30Z",
    "duration": 30
  }
  ```
- **Request Body (Bulk):**
  ```json
  [
    {
      "device_id": "PLAYER_01",
      "asset_id": "video1.mp4",
      "playlist_id": "PL05",
      "start_time": "2025-11-26T10:00:00Z",
      "end_time": "2025-11-26T10:00:30Z",
      "duration": 30
    },
    {
      "device_id": "PLAYER_02",
      "asset_id": "image1.jpg",
      "start_time": "2025-11-26T10:01:00Z",
      "end_time": "2025-11-26T10:01:15Z",
      "duration": 15
    }
  ]
  ```
- **Success Response (201 Created):**
  ```json
  {
    "success": true,
    "count": 2,
    "message": "Successfully logged 2 playback event(s)"
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Validation failed
  - `500 Internal Server Error`: Server error occurred

#### 2. Get Playback Report

Generate aggregated playback reports with filtering and pagination.

- **Endpoint:** `GET /api/playback/report`
- **Query Parameters:**
  | Parameter | Type | Description |
  |-----------|------|-------------|
  | `device_id` | string | Filter by device |
  | `asset_id` | string | Filter by asset |
  | `playlist_id` | string | Filter by playlist |
  | `date_from` | ISO date | Start of date range |
  | `date_to` | ISO date | End of date range |
  | `page` | number | Page number (default: 1) |
  | `limit` | number | Results per page (default: 50, max: 1000) |

- **Example:** `GET /api/playback/report?device_id=PLAYER_01&date_from=2025-11-26T00:00:00Z`
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "summary": [
      {
        "asset_id": "video1.mp4",
        "play_count": 32,
        "total_duration": 850,
        "first_played": "2025-11-26T08:00:00.000Z",
        "last_played": "2025-11-26T18:30:00.000Z",
        "unique_device_count": 5
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    },
    "filters": {
      "device_id": "PLAYER_01",
      "asset_id": null,
      "playlist_id": null,
      "date_from": "2025-11-26T00:00:00Z",
      "date_to": null
    }
  }
  ```

#### 3. Get Playback Statistics

Quick overall statistics without detailed breakdown.

- **Endpoint:** `GET /api/playback/stats`
- **Query Parameters:**
  | Parameter | Type | Description |
  |-----------|------|-------------|
  | `date_from` | ISO date | Start of date range |
  | `date_to` | ISO date | End of date range |

- **Success Response (200 OK):**
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
      "latest_play": "2025-11-26T18:30:00.000Z"
    }
  }
  ```

### Email Endpoints

#### 1. Submit Quote Request

Handle quote request submissions and send email notifications.

- **Endpoint:** `POST /api/email/quota`
- **Request Body:**
  ```json
  {
    "product": {
      "name": "string (required)",
      "pixelPitch": number,
      "resolution": {
        "width": number,
        "height": number
      },
      "cabinetDimensions": {
        "width": number,
        "height": number
      }
    },
    "cabinetGrid": {
      "columns": number,
      "rows": number
    },
    "message": "string (required)",
    "displaySize": {
      "width": number,
      "height": number
    },
    "aspectRatio": "string"
  }
  ```
- **Success Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Quote request submitted successfully",
    "data": {}
  }
  ```
- **Error Responses:**
  - `400 Bad Request`: Missing required fields
  - `500 Internal Server Error`: Failed to process quote request

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```
PORT=3000
MONGODB_URI=your_mongodb_connection_string
RESEND_API_KEY=your_resend_api_key
TO_EMAIL=recipient@example.com
DEFAULT_FROM_EMAIL="Your Brand <noreply@yourdomain.com>"
```

## Error Handling

All error responses follow a consistent format:

```json
{
  "success": false,
  "message": "Error message"
}
```

Common HTTP status codes:
- `200`: Success
- `201`: Created - Resource created successfully
- `400`: Bad Request - Invalid input data
- `404`: Not Found - Resource not found
- `500`: Internal Server Error - Something went wrong on the server

## Postman Collection

A Postman collection is available for testing all API endpoints:

- **Location:** `postman/Playback-Logs-API.postman_collection.json`
- **Import:** In Postman, go to File → Import and select the JSON file
- **Variables:** Update `{{baseUrl}}` to match your server (default: `http://localhost:5000`)

## Sample Test Data

Sample JSON payloads for testing are available in:
- `sample-playback-logs.json` - Playback log examples
- `sample-quote-request.json` - Quote request examples
