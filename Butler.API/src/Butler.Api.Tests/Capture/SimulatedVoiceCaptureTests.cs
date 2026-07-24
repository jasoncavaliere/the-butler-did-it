using System.Net;
using Butler.Api.Application.Capture;
using Butler.Api.Application.Grocery;
using Butler.Api.Tests.TestSupport;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;

namespace Butler.Api.Tests.Capture;

/// <summary>
/// Criteria (G3): the simulated voice source resolves a spoken utterance and adds
/// it through <b>the same</b> resolve-and-add handler as the hub text source -
/// two thin normalizers over one behaviour, not two code paths. Live Alexa capture
/// is out of scope for this ticket; "simulated" means the transcript arrives as
/// text, so the voice path is exercised with no external dependency.
/// </summary>
public sealed class SimulatedVoiceCaptureTests : IClassFixture<ButlerApiFactory>
{
    private readonly ButlerApiFactory _factory;

    public SimulatedVoiceCaptureTests(ButlerApiFactory factory) => _factory = factory;

    [Fact]
    public async Task A_transcript_resolves_and_adds_through_the_shared_handler()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);
        const string week = "2026-W41";

        var captured = await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.VoiceRoute(householdId),
            new { utterance = "Butler, add eggs.", personId = "person-9", weekIso = week });

        Assert.Equal(CaptureSourceNames.SimulatedVoice, captured.GetProperty("captureSource").GetString());
        // The wake word and the trailing period are gone; the term is what the
        // shared normalizer extracted.
        Assert.Equal("eggs", captured.GetProperty("resolvedTerm").GetString());

        var item = captured.GetProperty("item");
        Assert.Equal("H-E-B Grade A Large Eggs", item.GetProperty("displayName").GetString());
        Assert.Equal(1, item.GetProperty("quantity").GetInt32());
        Assert.Equal("person-9", item.GetProperty("addedByPersonId").GetString());
        Assert.Equal(SimulatedHebConnector.SourceName, item.GetProperty("sourceConnector").GetString());

        var cart = await CaptureTestHelper.GetCartAsync(client, householdId, week);
        var line = Assert.Single(cart.GetProperty("items").EnumerateArray().ToArray());
        Assert.Equal("H-E-B Grade A Large Eggs", line.GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task A_chatty_transcript_still_resolves_to_the_product_term()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        var captured = await CaptureTestHelper.CaptureAsync(
            client,
            CaptureTestHelper.VoiceRoute(householdId),
            new
            {
                utterance = "Hey Butler, please add some bananas to the list!",
                personId = "person-10",
                weekIso = "2026-W42",
            });

        Assert.Equal("bananas", captured.GetProperty("resolvedTerm").GetString());
        Assert.Equal("Fresh Bananas", captured.GetProperty("item").GetProperty("displayName").GetString());
    }

    [Fact]
    public async Task A_transcript_that_is_only_a_wake_word_adds_nothing()
    {
        using var client = _factory.CreateClient();
        var householdId = await CaptureTestHelper.CreateHouseholdAsync(client);

        using var response = await CaptureTestHelper.PostAsync(
            client,
            CaptureTestHelper.VoiceRoute(householdId),
            new { utterance = "Butler?", personId = "person-11", weekIso = "2026-W43" });

        await CaptureTestHelper.AssertProblemAsync(
            response, HttpStatusCode.BadRequest, "No product was recognised in the utterance.");
    }

    [Fact]
    public async Task Both_registered_sources_reach_the_same_handler_instance()
    {
        // The AC that matters most here: one shared resolve-and-add handler behind
        // the seam. Substitute the handler and prove both sources call it, each
        // stamping its own source name and passing its normalized utterance.
        var handler = Substitute.For<ICaptureHandler>();
        handler
            .ResolveAndAddAsync(Arg.Any<string>(), Arg.Any<CaptureRequest>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult(CaptureResult.NoMatch((string)call[0], "eggs", "2026-W44")));

        var services = new ServiceCollection();
        services.AddSingleton(handler);
        services.AddCaptureFeature();
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        var sources = scope.ServiceProvider.GetServices<ICaptureSource>().ToList();
        Assert.Equal(2, sources.Count);

        foreach (var source in sources)
        {
            var result = await source.CaptureAsync(
                new CaptureRequest("household-1", "Butler, add eggs.", "person-1"),
                CancellationToken.None);
            Assert.Equal(source.SourceName, result.CaptureSource);
        }

        await handler
            .Received(1)
            .ResolveAndAddAsync(
                CaptureSourceNames.HubText,
                Arg.Is<CaptureRequest>(request => request.Utterance == "Butler, add eggs."),
                Arg.Any<CancellationToken>());
        await handler
            .Received(1)
            .ResolveAndAddAsync(
                CaptureSourceNames.SimulatedVoice,
                // The voice source stripped the wake word before delegating.
                Arg.Is<CaptureRequest>(request => request.Utterance == "add eggs."),
                Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(null, "")]
    [InlineData("Butler", "")]
    [InlineData("Butler, add eggs.", "add eggs.")]
    [InlineData("hey butler add milk", "add milk")]
    [InlineData("Ok Butler: add rice", "add rice")]
    [InlineData("okay butler, add bread", "add bread")]
    [InlineData("  add cheese  ", "add cheese")]
    public void The_voice_source_strips_one_leading_wake_word(string? transcript, string expected)
    {
        Assert.Equal(expected, SimulatedVoiceCaptureSource.NormalizeTranscript(transcript));
    }

    [Fact]
    public async Task The_voice_source_guards_its_inputs()
    {
        Assert.Throws<ArgumentNullException>(() => new SimulatedVoiceCaptureSource(null!));

        var source = new SimulatedVoiceCaptureSource(Substitute.For<ICaptureHandler>());
        Assert.Equal(CaptureSourceNames.SimulatedVoice, source.SourceName);
        await Assert.ThrowsAsync<ArgumentNullException>(
            () => source.CaptureAsync(null!, CancellationToken.None));
    }
}
