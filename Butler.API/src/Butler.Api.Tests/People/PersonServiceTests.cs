using System.ComponentModel.DataAnnotations;
using Butler.Api.Application.Auth;
using Butler.Api.Application.People;
using Butler.Api.Infrastructure.People;
using NSubstitute;

namespace Butler.Api.Tests.People;

/// <summary>
/// Unit tests for <see cref="PersonService"/> exercised against an NSubstitute
/// fake of the persistence seam. They pin the orchestration the integration tests
/// cannot easily force: unknown-person not-found signals, the read-back guards,
/// role validation, and the last-organizer guard on both demote and delete
/// (including the positive path once a second organizer exists).
/// </summary>
public sealed class PersonServiceTests
{
    private const string Household = "house-1";

    private static readonly string[] ExpectedOrder = ["a", "b", "c"];

    private static PersonEntity Person(string rowKey, string role, bool isChild = false) => new()
    {
        PartitionKey = Household,
        RowKey = rowKey,
        DisplayName = rowKey,
        Role = role,
        IsChild = isChild,
    };

    [Fact]
    public async Task CreateAsync_persists_role_and_child_flag_and_returns_persisted_etag()
    {
        var repo = Substitute.For<IPersonRepository>();
        PersonEntity? added = null;
        repo.When(r => r.AddAsync(Household, Arg.Any<PersonEntity>(), Arg.Any<CancellationToken>()))
            .Do(ci => added = ci.Arg<PersonEntity>());
        repo.GetAsync(Household, Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                added!.ETag = new Azure.ETag("persisted-etag");
                return added;
            });

        var service = new PersonService(repo);

        var result = await service.CreateAsync(
            Household, "Sam", "participant", isChild: true, claimColor: "#abcdef", CancellationToken.None);

        Assert.NotNull(added);
        Assert.False(string.IsNullOrWhiteSpace(added!.RowKey));
        Assert.Equal(OrganizerAuthorization.ParticipantRole, added.Role);
        Assert.True(added.IsChild);
        Assert.Equal("#abcdef", added.ClaimColor);
        Assert.Equal("persisted-etag", result.ETag);
        Assert.True(result.IsChild);
    }

    [Fact]
    public async Task CreateAsync_throws_when_the_created_person_cannot_be_read_back()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((PersonEntity?)null);

        var service = new PersonService(repo);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.CreateAsync(Household, "Sam", "Participant", false, null, CancellationToken.None));
    }

    [Fact]
    public async Task CreateAsync_rejects_an_unknown_role()
    {
        var repo = Substitute.For<IPersonRepository>();
        var service = new PersonService(repo);

        await Assert.ThrowsAsync<ValidationException>(
            () => service.CreateAsync(Household, "Sam", "Wizard", false, null, CancellationToken.None));
        await repo.DidNotReceive().AddAsync(
            Arg.Any<string>(), Arg.Any<PersonEntity>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ListAsync_orders_by_person_id()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.ListAsync(Household, Arg.Any<CancellationToken>())
            .Returns(new List<PersonEntity>
            {
                Person("c", OrganizerAuthorization.ParticipantRole),
                Person("a", OrganizerAuthorization.OrganizerRole),
                Person("b", OrganizerAuthorization.ParticipantRole),
            });

        var service = new PersonService(repo);

        var result = await service.ListAsync(Household, CancellationToken.None);

        Assert.Equal(ExpectedOrder, result.Select(p => p.PersonId).ToArray());
    }

    [Fact]
    public async Task GetAsync_returns_null_when_the_person_does_not_exist()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((PersonEntity?)null);

        var service = new PersonService(repo);

        Assert.Null(await service.GetAsync(Household, "p-1", CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_returns_null_when_the_person_does_not_exist()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((PersonEntity?)null);

        var service = new PersonService(repo);

        var result = await service.UpdateAsync(
            Household, "p-1", "Sam", "Participant", false, null, "*", CancellationToken.None);

        Assert.Null(result);
        await repo.DidNotReceive().UpdateAsync(
            Arg.Any<string>(), Arg.Any<PersonEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateAsync_throws_when_the_updated_person_cannot_be_read_back()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Household, "p-1", Arg.Any<CancellationToken>())
            .Returns(
                _ => Person("p-1", OrganizerAuthorization.ParticipantRole),
                _ => null);

        var service = new PersonService(repo);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => service.UpdateAsync(Household, "p-1", "Sam", "Participant", false, null, "*", CancellationToken.None));
    }

    [Fact]
    public async Task UpdateAsync_of_a_participant_does_not_consult_the_organizer_guard()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Household, "p-1", Arg.Any<CancellationToken>())
            .Returns(Person("p-1", OrganizerAuthorization.ParticipantRole));

        var service = new PersonService(repo);

        await service.UpdateAsync(Household, "p-1", "Sam", "Participant", true, "#fff", "*", CancellationToken.None);

        await repo.DidNotReceive().ListAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
        await repo.Received(1).UpdateAsync(
            Household, Arg.Any<PersonEntity>(), "*", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateAsync_rejects_demoting_the_last_organizer_and_leaves_the_row_unwritten()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Household, "org-1", Arg.Any<CancellationToken>())
            .Returns(Person("org-1", OrganizerAuthorization.OrganizerRole));
        repo.ListAsync(Household, Arg.Any<CancellationToken>())
            .Returns(new List<PersonEntity>
            {
                Person("org-1", OrganizerAuthorization.OrganizerRole),
                Person("p-1", OrganizerAuthorization.ParticipantRole),
            });

        var service = new PersonService(repo);

        await Assert.ThrowsAsync<LastOrganizerException>(
            () => service.UpdateAsync(
                Household, "org-1", "Owner", "Participant", false, null, "*", CancellationToken.None));
        await repo.DidNotReceive().UpdateAsync(
            Arg.Any<string>(), Arg.Any<PersonEntity>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task UpdateAsync_allows_demotion_when_a_second_organizer_exists()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Household, "org-1", Arg.Any<CancellationToken>())
            .Returns(Person("org-1", OrganizerAuthorization.OrganizerRole));
        repo.ListAsync(Household, Arg.Any<CancellationToken>())
            .Returns(new List<PersonEntity>
            {
                Person("org-1", OrganizerAuthorization.OrganizerRole),
                Person("org-2", OrganizerAuthorization.OrganizerRole),
            });

        var service = new PersonService(repo);

        var result = await service.UpdateAsync(
            Household, "org-1", "Owner", "Participant", false, null, "*", CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(OrganizerAuthorization.ParticipantRole, result!.Role);
        await repo.Received(1).UpdateAsync(
            Household, Arg.Any<PersonEntity>(), "*", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteAsync_returns_false_when_the_person_does_not_exist()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((PersonEntity?)null);

        var service = new PersonService(repo);

        Assert.False(await service.DeleteAsync(Household, "p-1", CancellationToken.None));
        await repo.DidNotReceive().DeleteAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteAsync_removes_a_participant_without_consulting_the_guard()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Household, "p-1", Arg.Any<CancellationToken>())
            .Returns(Person("p-1", OrganizerAuthorization.ParticipantRole));

        var service = new PersonService(repo);

        Assert.True(await service.DeleteAsync(Household, "p-1", CancellationToken.None));
        await repo.DidNotReceive().ListAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
        await repo.Received(1).DeleteAsync(
            Household, "p-1", Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteAsync_rejects_removing_the_last_organizer()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Household, "org-1", Arg.Any<CancellationToken>())
            .Returns(Person("org-1", OrganizerAuthorization.OrganizerRole));
        repo.ListAsync(Household, Arg.Any<CancellationToken>())
            .Returns(new List<PersonEntity> { Person("org-1", OrganizerAuthorization.OrganizerRole) });

        var service = new PersonService(repo);

        await Assert.ThrowsAsync<LastOrganizerException>(
            () => service.DeleteAsync(Household, "org-1", CancellationToken.None));
        await repo.DidNotReceive().DeleteAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task DeleteAsync_removes_an_organizer_when_a_second_organizer_exists()
    {
        var repo = Substitute.For<IPersonRepository>();
        repo.GetAsync(Household, "org-1", Arg.Any<CancellationToken>())
            .Returns(Person("org-1", OrganizerAuthorization.OrganizerRole));
        repo.ListAsync(Household, Arg.Any<CancellationToken>())
            .Returns(new List<PersonEntity>
            {
                Person("org-1", OrganizerAuthorization.OrganizerRole),
                Person("org-2", OrganizerAuthorization.OrganizerRole),
            });

        var service = new PersonService(repo);

        Assert.True(await service.DeleteAsync(Household, "org-1", CancellationToken.None));
        await repo.Received(1).DeleteAsync(
            Household, "org-1", Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }
}
