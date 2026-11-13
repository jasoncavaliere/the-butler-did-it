namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Records that a feature registered a Table Storage table through
/// <see cref="StorageServiceCollectionExtensions.AddTableRepository{TEntity}"/>.
/// One is added per call (duplicates included); <see cref="TableProvisioner"/>
/// reads them all and creates each distinct table once at startup (#91).
/// </summary>
/// <param name="TableName">The Table Storage table name (for example <c>Households</c>).</param>
public sealed record TableRegistration(string TableName);
