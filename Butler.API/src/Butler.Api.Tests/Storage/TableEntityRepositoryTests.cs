using System.Linq.Expressions;
using Azure;
using Azure.Data.Tables;
using Butler.Api.Application.Concurrency;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Tests.TestSupport;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace Butler.Api.Tests.Storage;

/// <summary>
/// Criterion: the Table-backed repository scopes every operation to the household
/// (<c>PartitionKey = householdId</c>) and enforces optimistic concurrency by
/// pre-checking the <c>If-Match</c> (<c>428</c>) and translating the Table
/// service's precondition failure to <c>412</c>. The <see cref="TableClient"/> is
/// substituted so no Azurite or cloud storage is needed.
/// </summary>
public sealed class TableEntityRepositoryTests
{
    private readonly TableClient _client = Substitute.For<TableClient>();
    private readonly TableEntityRepository<FakeEntity> _repository;

    public TableEntityRepositoryTests()
    {
        _repository = new TableEntityRepository<FakeEntity>(_client);
    }

    [Fact]
    public async Task Get_returns_the_entity_when_it_exists()
    {
        var entity = new FakeEntity { PartitionKey = "house-1", RowKey = "row-1", Payload = "hi" };
        var response = Substitute.For<NullableResponse<FakeEntity>>();
        response.HasValue.Returns(true);
        response.Value.Returns(entity);
        _client
            .GetEntityIfExistsAsync<FakeEntity>("house-1", "row-1", Arg.Any<IEnumerable<string>>(), Arg.Any<CancellationToken>())
            .Returns(response);

        var result = await _repository.GetAsync("house-1", "row-1");

        Assert.Same(entity, result);
    }

    [Fact]
    public async Task Get_returns_null_when_the_entity_is_absent()
    {
        var response = Substitute.For<NullableResponse<FakeEntity>>();
        response.HasValue.Returns(false);
        _client
            .GetEntityIfExistsAsync<FakeEntity>(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<IEnumerable<string>>(), Arg.Any<CancellationToken>())
            .Returns(response);

        Assert.Null(await _repository.GetAsync("house-1", "absent"));
    }

    [Fact]
    public async Task List_returns_the_household_partition()
    {
        var entities = new[]
        {
            new FakeEntity { PartitionKey = "house-1", RowKey = "row-1" },
            new FakeEntity { PartitionKey = "house-1", RowKey = "row-2" },
        };
        var page = Page<FakeEntity>.FromValues(entities, continuationToken: null, Substitute.For<Response>());
        _client
            .QueryAsync<FakeEntity>(
                Arg.Any<Expression<Func<FakeEntity, bool>>>(),
                Arg.Any<int?>(),
                Arg.Any<IEnumerable<string>>(),
                Arg.Any<CancellationToken>())
            .Returns(AsyncPageable<FakeEntity>.FromPages(new[] { page }));

        var result = await _repository.ListAsync("house-1");

        Assert.Equal(2, result.Count);
    }

    [Fact]
    public async Task Add_scopes_the_partition_key_and_calls_the_client()
    {
        var entity = new FakeEntity { RowKey = "row-1" };

        await _repository.AddAsync("house-1", entity);

        Assert.Equal("house-1", entity.PartitionKey);
        await _client.Received(1).AddEntityAsync(entity, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Upsert_scopes_the_partition_key_and_replaces()
    {
        var entity = new FakeEntity { RowKey = "row-1" };

        await _repository.UpsertAsync("house-1", entity);

        Assert.Equal("house-1", entity.PartitionKey);
        await _client.Received(1).UpsertEntityAsync(entity, TableUpdateMode.Replace, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Update_without_an_if_match_is_428_and_never_calls_the_client()
    {
        var entity = new FakeEntity { RowKey = "row-1" };

        await Assert.ThrowsAsync<PreconditionRequiredException>(
            () => _repository.UpdateAsync("house-1", entity, ifMatch: null));

        await _client.DidNotReceive().UpdateEntityAsync(
            Arg.Any<FakeEntity>(), Arg.Any<ETag>(), Arg.Any<TableUpdateMode>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Update_passes_the_if_match_and_scopes_the_partition_key()
    {
        var entity = new FakeEntity { RowKey = "row-1" };

        await _repository.UpdateAsync("house-1", entity, "etag-1");

        Assert.Equal("house-1", entity.PartitionKey);
        await _client.Received(1).UpdateEntityAsync(
            entity, new ETag("etag-1"), TableUpdateMode.Replace, Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(412)]
    [InlineData(404)]
    public async Task Update_translates_a_precondition_failure_to_412(int status)
    {
        _client
            .UpdateEntityAsync(Arg.Any<FakeEntity>(), Arg.Any<ETag>(), Arg.Any<TableUpdateMode>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new RequestFailedException(status, "precondition"));

        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => _repository.UpdateAsync("house-1", new FakeEntity { RowKey = "row-1" }, "etag-1"));
    }

    [Fact]
    public async Task Update_rethrows_unrelated_storage_failures()
    {
        _client
            .UpdateEntityAsync(Arg.Any<FakeEntity>(), Arg.Any<ETag>(), Arg.Any<TableUpdateMode>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new RequestFailedException(500, "boom"));

        await Assert.ThrowsAsync<RequestFailedException>(
            () => _repository.UpdateAsync("house-1", new FakeEntity { RowKey = "row-1" }, "etag-1"));
    }

    [Fact]
    public async Task Delete_without_an_if_match_is_428()
    {
        await Assert.ThrowsAsync<PreconditionRequiredException>(
            () => _repository.DeleteAsync("house-1", "row-1", ifMatch: null));
    }

    [Fact]
    public async Task Delete_passes_the_if_match_to_the_client()
    {
        await _repository.DeleteAsync("house-1", "row-1", "etag-1");

        await _client.Received(1).DeleteEntityAsync(
            "house-1", "row-1", new ETag("etag-1"), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Delete_translates_a_precondition_failure_to_412()
    {
        _client
            .DeleteEntityAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<ETag>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new RequestFailedException(412, "stale"));

        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => _repository.DeleteAsync("house-1", "row-1", "etag-1"));
    }

    [Fact]
    public async Task Delete_rethrows_unrelated_storage_failures()
    {
        _client
            .DeleteEntityAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<ETag>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new RequestFailedException(500, "boom"));

        await Assert.ThrowsAsync<RequestFailedException>(
            () => _repository.DeleteAsync("house-1", "row-1", "etag-1"));
    }

    // ---- SubmitBatchAsync: one entity-group transaction per 100 operations (#319) ----

    private static Response<IReadOnlyList<Response>> TransactionSucceeded() =>
        Response.FromValue<IReadOnlyList<Response>>(Array.Empty<Response>(), Substitute.For<Response>());

    private List<List<TableTransactionAction>> CaptureTransactions()
    {
        var submitted = new List<List<TableTransactionAction>>();
        _client
            .SubmitTransactionAsync(Arg.Any<IEnumerable<TableTransactionAction>>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                submitted.Add(call.Arg<IEnumerable<TableTransactionAction>>().ToList());
                return TransactionSucceeded();
            });
        return submitted;
    }

    [Fact]
    public async Task Batch_submits_adds_and_updates_in_one_transaction_scoped_to_the_household()
    {
        var submitted = CaptureTransactions();
        var added = new FakeEntity { RowKey = "row-1" };
        var replaced = new FakeEntity { RowKey = "row-2", PartitionKey = "elsewhere" };

        await _repository.SubmitBatchAsync(
            "house-1",
            [
                new(EntityBatchOperationKind.Add, added),
                new(EntityBatchOperationKind.Update, replaced, "etag-2"),
            ]);

        var transaction = Assert.Single(submitted);
        Assert.Collection(
            transaction,
            action =>
            {
                Assert.Equal(TableTransactionActionType.Add, action.ActionType);
                Assert.Same(added, action.Entity);
                Assert.Equal(default, action.ETag);
            },
            action =>
            {
                Assert.Equal(TableTransactionActionType.UpdateReplace, action.ActionType);
                Assert.Same(replaced, action.Entity);
                Assert.Equal(new ETag("etag-2"), action.ETag);
            });
        Assert.Equal("house-1", added.PartitionKey);
        Assert.Equal("house-1", replaced.PartitionKey);
    }

    [Fact]
    public async Task Batch_of_101_operations_is_two_transactions()
    {
        var submitted = CaptureTransactions();
        var operations = Enumerable.Range(0, 101)
            .Select(i => new EntityBatchOperation<FakeEntity>(
                EntityBatchOperationKind.Add, new FakeEntity { RowKey = $"row-{i}" }))
            .ToList();

        await _repository.SubmitBatchAsync("house-1", operations);

        Assert.Collection(
            submitted,
            first => Assert.Equal(100, first.Count),
            second => Assert.Equal("row-100", Assert.Single(second).Entity.RowKey));
    }

    [Fact]
    public async Task Batch_with_no_operations_makes_no_call()
    {
        await _repository.SubmitBatchAsync("house-1", []);

        await _client.DidNotReceiveWithAnyArgs().SubmitTransactionAsync(default!, default);
    }

    [Fact]
    public async Task Batch_update_without_an_if_match_is_428_before_any_call()
    {
        await Assert.ThrowsAsync<PreconditionRequiredException>(
            () => _repository.SubmitBatchAsync(
                "house-1",
                [
                    new(EntityBatchOperationKind.Add, new FakeEntity { RowKey = "row-1" }),
                    new(EntityBatchOperationKind.Update, new FakeEntity { RowKey = "row-2" }),
                ]));

        await _client.DidNotReceiveWithAnyArgs().SubmitTransactionAsync(default!, default);
    }

    [Fact]
    public async Task Batch_rejects_a_blank_household_and_null_operations()
    {
        await Assert.ThrowsAnyAsync<ArgumentException>(
            () => _repository.SubmitBatchAsync(" ", []));
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => _repository.SubmitBatchAsync("house-1", null!));
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => _repository.SubmitBatchAsync("house-1", [null!]));

        await _client.DidNotReceiveWithAnyArgs().SubmitTransactionAsync(default!, default);
    }

    [Theory]
    [InlineData(412)]
    [InlineData(404)]
    public async Task Batch_translates_a_precondition_failure_to_412(int status)
    {
        _client
            .SubmitTransactionAsync(Arg.Any<IEnumerable<TableTransactionAction>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new TableTransactionFailedException(new RequestFailedException(status, "precondition")));

        await Assert.ThrowsAsync<PreconditionFailedException>(
            () => _repository.SubmitBatchAsync(
                "house-1", [new(EntityBatchOperationKind.Update, new FakeEntity { RowKey = "row-1" }, "etag-1")]));
    }

    [Fact]
    public async Task Batch_rethrows_a_conflicting_add()
    {
        _client
            .SubmitTransactionAsync(Arg.Any<IEnumerable<TableTransactionAction>>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new TableTransactionFailedException(new RequestFailedException(409, "exists")));

        var ex = await Assert.ThrowsAnyAsync<RequestFailedException>(
            () => _repository.SubmitBatchAsync(
                "house-1", [new(EntityBatchOperationKind.Add, new FakeEntity { RowKey = "row-1" })]));
        Assert.Equal(409, ex.Status);
    }
}
