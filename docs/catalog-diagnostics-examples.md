# Catalog Diagnostics Examples

## Example 1: Successful discovery with refresh

Request:
```json
{
  "projectKey": "AA",
  "sprintId": 123,
  "appSlug": "arquitectura-automatizacion",
  "catalogOptions": {
    "useDiscoveredCatalog": true,
    "catalogMode": "refresh",
    "coverageMode": "exhaustive",
    "maxProductsPerCategory": 10
  }
}
```

Response catalogDiagnostics:
```json
{
  "catalogUsed": true,
  "discoveryRefreshed": true,
  "discoveredProductCount": 10,
  "representativeProductCount": 10,
  "discoveryTimestamp": "2026-06-11T18:30:45.123Z",
  "warnings": []
}
```

## Example 2: Reusing existing catalog

Request:
```json
{
  "projectKey": "AA",
  "sprintId": 123,
  "appSlug": "kiosko",
  "catalogOptions": {
    "useDiscoveredCatalog": true,
    "catalogMode": "existing",
    "coverageMode": "representative",
    "maxProductsPerCategory": 2
  }
}
```

Response catalogDiagnostics (catalog exists and is fresh):
```json
{
  "catalogUsed": true,
  "discoveryRefreshed": false,
  "discoveredProductCount": 10,
  "representativeProductCount": 10,
  "warnings": []
}
```

## Example 3: Discovery disabled by request

Request:
```json
{
  "projectKey": "AA",
  "sprintId": 123,
  "appSlug": "test-app",
  "catalogOptions": {
    "useDiscoveredCatalog": false
  }
}
```

Response catalogDiagnostics:
```json
{
  "catalogUsed": false,
  "discoveryRefreshed": false,
  "discoveredProductCount": 0,
  "representativeProductCount": 0,
  "warnings": [],
  "fallbackReason": "disabled_by_request"
}
```

## Example 4: Discovery failure (graceful fallback)

Request:
```json
{
  "projectKey": "AA",
  "sprintId": 123,
  "appSlug": "test-app",
  "catalogOptions": {
    "useDiscoveredCatalog": true,
    "catalogMode": "refresh"
  }
}
```

Response catalogDiagnostics (browser launch failed):
```json
{
  "catalogUsed": false,
  "discoveryRefreshed": false,
  "discoveredProductCount": 0,
  "representativeProductCount": 0,
  "warnings": [
    "Discovery failed: Browser launch timeout after 30s"
  ],
  "fallbackReason": "discovery_error"
}
```

## Example 5: No routeProfile available

Request:
```json
{
  "projectKey": "AA",
  "sprintId": 123,
  "appSlug": "new-app-without-config",
  "catalogOptions": {
    "useDiscoveredCatalog": true,
    "catalogMode": "existing"
  }
}
```

Response catalogDiagnostics:
```json
{
  "catalogUsed": false,
  "discoveryRefreshed": false,
  "discoveredProductCount": 0,
  "representativeProductCount": 0,
  "warnings": [
    "No routeProfile available for catalog discovery"
  ],
  "fallbackReason": "no_route_profile"
}
```

## Example 6: Stale catalog triggers refresh

Request:
```json
{
  "projectKey": "AA",
  "sprintId": 123,
  "appSlug": "kiosko",
  "catalogOptions": {
    "useDiscoveredCatalog": true,
    "catalogMode": "existing"
  }
}
```

Response catalogDiagnostics (catalog was 10 days old, refreshed automatically):
```json
{
  "catalogUsed": true,
  "discoveryRefreshed": true,
  "discoveredProductCount": 12,
  "representativeProductCount": 12,
  "discoveryTimestamp": "2026-06-11T18:35:22.456Z",
  "warnings": []
}
```

Log output:
```
[catalog-context] existing catalog is stale (10 days old)
[catalog-context] starting catalog discovery (reason: catalog_stale)
[catalog-discovery] discovered 12 products, persisted 12 representative
```

## Example 7: Exhaustive coverage with seeds

Request:
```json
{
  "projectKey": "AA",
  "sprintId": 123,
  "appSlug": "kiosko",
  "catalogOptions": {
    "useDiscoveredCatalog": true,
    "catalogMode": "existing",
    "coverageMode": "exhaustive"
  }
}
```

Response summary:
```json
{
  "summary": {
    "generated": 10,
    "valid": 10,
    "invalid": 0,
    "rejected": 0,
    "blocked": 0
  },
  "catalogDiagnostics": {
    "catalogUsed": true,
    "discoveryRefreshed": false,
    "discoveredProductCount": 10,
    "representativeProductCount": 10,
    "warnings": []
  }
}
```

Where:
- AI generated 3 scenarios (covering products A, B, C)
- Deterministic seeds added 7 scenarios (covering products D-J)
- Total: 10 scenarios = exhaustive coverage aligned with HU
