using Azure.Data.Tables;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Butler.Api.Infrastructure.Storage;

/// <summary>
/// Composition entry point for the shared Table Storage seam (Engineering
/// Contract 7.3). <see cref="AddStorage"/> binds configuration and registers the
/// client factory once; feature modules then register their own tables with
/// <see cref="AddTableRepository{TEntity}"/>, which transparently resolves to the
/// in-memory fallback or the Table-backed store based on configuration - so no
/// feature has to know which store is in play. Every registered table is
/// recorded as a <see cref="TableRegistration"/>, and in Table mode
/// <see cref="TableProvisioningHostedService"/> creates them all before the API
/// accepts requests (#91).
/// </summary>
public static class StorageServiceCollectionExtensions
{
    /// <summary>
    /// Binds <see cref="StorageOptions"/> from the <c>Storage</c> configuration
    /// section and registers <see cref="ITableClientFactory"/>, the
    /// <see cref="TableProvisioner"/>, and the hosted service that runs it at
    /// startup. Call once in the composition root. The in-memory decision is made
    /// when provisioning runs, so settings added after this call still count.
    /// </summary>
    public static IServiceCollection AddStorage(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        services.Configure<StorageOptions>(configuration.GetSection(StorageOptions.SectionName));
        services.TryAddSingleton<ITableClientFactory, TableClientFactory>();
        services.TryAddSingleton<TableProvisioner>();
        services.AddHostedService<TableProvisioningHostedService>();
        return services;
    }

    /// <summary>
    /// Registers an <see cref="IEntityRepository{TEntity}"/> for the given table.
    /// When the in-memory fallback is selected (no storage configured, or
    /// <c>Storage:UseInMemoryStore</c> is <c>true</c>) it resolves to
    /// <see cref="InMemoryEntityRepository{TEntity}"/>; otherwise to a
    /// <see cref="TableEntityRepository{TEntity}"/> bound to
    /// <paramref name="tableName"/> via the factory. Every call also records a
    /// <see cref="TableRegistration"/>, so the table is created at startup in
    /// Table mode.
    /// </summary>
    /// <typeparam name="TEntity">The Table entity type stored in the table.</typeparam>
    /// <param name="tableName">The Table Storage table name (for example <c>Households</c>).</param>
    public static IServiceCollection AddTableRepository<TEntity>(this IServiceCollection services, string tableName)
        where TEntity : class, ITableEntity, new()
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentException.ThrowIfNullOrWhiteSpace(tableName);

        services.AddSingleton(new TableRegistration(tableName));
        services.TryAddSingleton<IEntityRepository<TEntity>>(serviceProvider =>
        {
            var options = serviceProvider.GetRequiredService<IOptions<StorageOptions>>().Value;
            if (options.ResolveUseInMemory())
            {
                return new InMemoryEntityRepository<TEntity>();
            }

            var factory = serviceProvider.GetRequiredService<ITableClientFactory>();
            return new TableEntityRepository<TEntity>(factory.GetTableClient(tableName));
        });

        return services;
    }
}
