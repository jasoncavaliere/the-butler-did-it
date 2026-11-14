namespace Butler.Api.Application.System;

/// <summary>Body of <c>GET /api/system/dataset</c> (#100 D7).</summary>
/// <param name="DatasetId">The deployment's current dataset id.</param>
public sealed record DatasetResponse(string DatasetId);
