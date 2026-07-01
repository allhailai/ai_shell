# API Design

## Overview

Describe the API's purpose, target consumers, and key design principles.

## Base URL & Versioning

- **Base URL**: 
- **Versioning Strategy**: 

## Authentication & Authorization

- **Auth Mechanism**: 
- **Required Scopes/Roles**: 

## Endpoints

### `GET /resource`

List resources with pagination and filtering.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | integer | No | Max items to return (default: 20) |
| `offset` | integer | No | Pagination offset |

**Response** `200 OK`:

```json
{
  "items": [],
  "total": 0
}
```

### `POST /resource`

Create a new resource.

**Request Body:**

```json
{
  "name": "string",
  "description": "string"
}
```

**Response** `201 Created`:

```json
{
  "id": "string",
  "name": "string",
  "createdAt": "ISO 8601"
}
```

### `GET /resource/:id`

Get a single resource by ID.

**Response** `200 OK`:

```json
{
  "id": "string",
  "name": "string"
}
```

### `PUT /resource/:id`

Update a resource.

### `DELETE /resource/:id`

Delete a resource.

**Response** `204 No Content`

## Error Handling

All errors follow a consistent format:

```json
{
  "error": "Human-readable message",
  "code": "machine_readable_code",
  "details": {}
}
```

| Status | Code | Description |
|--------|------|-------------|
| 400 | `invalid_input` | Request validation failed |
| 401 | `unauthorized` | Missing or invalid authentication |
| 403 | `forbidden` | Insufficient permissions |
| 404 | `not_found` | Resource not found |
| 409 | `conflict` | Resource conflict |
| 429 | `rate_limited` | Too many requests |

## Rate Limiting

- **Default Limit**: 
- **Headers**: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Open Questions

- [ ] 
