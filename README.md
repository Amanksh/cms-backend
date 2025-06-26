# Origins CMS Backend

A Content Management System (CMS) backend for managing digital displays and handling quote requests. This API provides endpoints for display management and email notifications.

## Table of Contents

- [Getting Started](#getting-started)
- [API Documentation](#api-documentation)
  - [Display Endpoints](#display-endpoints)
  - [Email Endpoints](#email-endpoints)
- [Environment Variables](#environment-variables)
- [Error Handling](#error-handling)

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
- `400`: Bad Request - Invalid input data
- `404`: Not Found - Resource not found
- `500`: Internal Server Error - Something went wrong on the server
