using Butler.Api.Application.Households;
using Butler.Api.Infrastructure.Households;
using MediatR;

namespace Butler.Api.Mediation;

/// <summary>
/// MediatR pipeline behavior that checks an organizer create or update targets a
/// household that exists (#295). For a request marked
/// <see cref="IHouseholdWriteRequest"/> it reads the <c>Households</c> row before
/// the handler runs and throws <see cref="HouseholdNotFoundException"/> (mapped to
/// <c>404</c>) when it is missing, so nothing is written. Every other request
/// passes straight through without a read. The check is not atomic with the
/// write: a write whose check passed just before a teardown deleted the household
/// row can still commit.
/// </summary>
/// <typeparam name="TRequest">The request type.</typeparam>
/// <typeparam name="TResponse">The response type.</typeparam>
public sealed class HouseholdExistsBehavior<TRequest, TResponse> : IPipelineBehavior<TRequest, TResponse>
    where TRequest : notnull
{
    private readonly IHouseholdRepository _households;

    public HouseholdExistsBehavior(IHouseholdRepository households)
    {
        ArgumentNullException.ThrowIfNull(households);
        _households = households;
    }

    public async Task<TResponse> Handle(
        TRequest request,
        RequestHandlerDelegate<TResponse> next,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(next);

        if (request is IHouseholdWriteRequest write)
        {
            var household = await _households.GetAsync(write.HouseholdId, cancellationToken).ConfigureAwait(false);
            if (household is null)
            {
                throw HouseholdNotFoundException.ForHousehold(write.HouseholdId);
            }
        }

        return await next().ConfigureAwait(false);
    }
}
